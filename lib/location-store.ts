import { and, desc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { locationDevices, locationPings } from "@/db/schema";
import type { DevicePosition, DeviceKind, LocationDevice } from "@/lib/location";

// Device locations. Each device pings with its own token (only its hash is
// stored); positions are encrypted, and only the most recent few per device
// are kept.

const PINGS_KEPT_PER_DEVICE = 50;
const MAX_DEVICES = 20;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function locationKey() {
  const secret =
    process.env.VOX_CONVERSATION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-conversation-secret" : "");
  if (!secret) throw new Error("Vox location security is not configured.");
  // Its own key, derived separately from the conversation key.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`device-locations:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptPosition(position: DevicePosition, deviceId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(deviceId) },
    await locationKey(),
    new TextEncoder().encode(JSON.stringify(position)),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decryptPosition(ciphertext: string, iv: string, deviceId: string): Promise<DevicePosition | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(iv), additionalData: new TextEncoder().encode(deviceId) },
      await locationKey(),
      base64UrlToBytes(ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as DevicePosition;
  } catch {
    return null;
  }
}

export class LocationLimitError extends Error {}

/** Adds a device and returns its ping token, shown this once. */
export async function registerLocationDevice(ownerId: string, name: string, kind: DeviceKind) {
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(locationDevices)
    .where(eq(locationDevices.ownerId, ownerId));
  if (Number(count) >= MAX_DEVICES) throw new LocationLimitError("Remove a device before adding another.");
  const id = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12)));
  const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await getDb().insert(locationDevices).values({
    id,
    ownerId,
    name,
    kind,
    tokenHash: await sha256(token),
    createdAt: new Date().toISOString(),
  });
  return { deviceId: id, token };
}

/** Records a ping from the device holding this token. False if the token isn't valid. */
export async function recordLocationPing(token: string, position: DevicePosition) {
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(token)) return false;
  const [device] = await getDb()
    .select({ id: locationDevices.id, ownerId: locationDevices.ownerId })
    .from(locationDevices)
    .where(eq(locationDevices.tokenHash, await sha256(token)))
    .limit(1);
  if (!device) return false;
  const now = new Date().toISOString();
  const encrypted = await encryptPosition(position, device.id);
  await getDb().insert(locationPings).values({
    id: crypto.randomUUID(),
    ownerId: device.ownerId,
    deviceId: device.id,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    capturedAt: position.capturedAt,
    receivedAt: now,
  });
  await getDb().update(locationDevices).set({ lastSeenAt: now }).where(eq(locationDevices.id, device.id));
  await getDb().run(sql`
    DELETE FROM location_pings
    WHERE device_id = ${device.id}
      AND id NOT IN (
        SELECT id FROM location_pings WHERE device_id = ${device.id}
        ORDER BY captured_at DESC LIMIT ${PINGS_KEPT_PER_DEVICE}
      )
  `);
  return true;
}

/** The owner's devices, each with its latest position. */
export async function listLocationDevices(ownerId: string): Promise<LocationDevice[]> {
  const devices = await getDb()
    .select()
    .from(locationDevices)
    .where(eq(locationDevices.ownerId, ownerId))
    .orderBy(desc(locationDevices.lastSeenAt));
  return Promise.all(
    devices.map(async (device) => {
      const [latest] = await getDb()
        .select({ ciphertext: locationPings.ciphertext, iv: locationPings.iv })
        .from(locationPings)
        .where(and(eq(locationPings.deviceId, device.id), eq(locationPings.ownerId, ownerId)))
        .orderBy(desc(locationPings.capturedAt))
        .limit(1);
      return {
        id: device.id,
        name: device.name,
        kind: device.kind as DeviceKind,
        createdAt: device.createdAt,
        lastSeenAt: device.lastSeenAt,
        last: latest ? await decryptPosition(latest.ciphertext, latest.iv, device.id) : null,
      };
    }),
  );
}

/** Removes a device: its token stops working and its positions are deleted. */
export async function removeLocationDevice(ownerId: string, deviceId: string) {
  await getDb().delete(locationPings).where(and(eq(locationPings.deviceId, deviceId), eq(locationPings.ownerId, ownerId)));
  const result = await getDb()
    .delete(locationDevices)
    .where(and(eq(locationDevices.id, deviceId), eq(locationDevices.ownerId, ownerId)))
    .returning({ id: locationDevices.id });
  return result.length > 0;
}
