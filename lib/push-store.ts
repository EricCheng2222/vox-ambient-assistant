import { and, asc, desc, eq, gt, lt, ne, notInArray } from "drizzle-orm";

import { getDb } from "@/db";
import { ownerNotices, phoneAssistantSettings, pushDevices } from "@/db/schema";
import { isDeviceToken, type ApnsDevice } from "@/lib/apns";
import { isPhoneAssistantOwner } from "@/lib/phone-assistant-store";

// The devices an account's notifications go to (see db/schema.ts, push_devices).

const MAX_DEVICES_PER_OWNER = 8;

export async function registerPushDevice(ownerId: string, device: { token: string; environment: string; platform: string }, nowIso: string) {
  if (!isDeviceToken(device.token)) return false;
  const environment = device.environment === "production" || device.environment === "development" ? device.environment : "pull";
  const platform = device.platform === "ipados" ? "ipados" : "ios";
  const db = getDb();
  await db
    .insert(pushDevices)
    .values({ token: device.token, ownerId, environment, platform, createdAt: nowIso, seenAt: nowIso })
    .onConflictDoUpdate({ target: pushDevices.token, set: { ownerId, environment, platform, seenAt: nowIso } });
  // The most recently seen few are kept.
  const rows = await db.select({ token: pushDevices.token, seenAt: pushDevices.seenAt }).from(pushDevices).where(eq(pushDevices.ownerId, ownerId));
  if (rows.length > MAX_DEVICES_PER_OWNER) {
    const keep = rows.sort((a, b) => b.seenAt.localeCompare(a.seenAt)).slice(0, MAX_DEVICES_PER_OWNER).map((row) => row.token);
    await db.delete(pushDevices).where(and(eq(pushDevices.ownerId, ownerId), notInArray(pushDevices.token, keep)));
  }
  return true;
}

/** Devices Apple can push to. Ones that collect notices themselves are not among them. */
export async function pushDevicesFor(ownerId: string): Promise<ApnsDevice[]> {
  const rows = await getDb()
    .select({ token: pushDevices.token, environment: pushDevices.environment })
    .from(pushDevices)
    .where(and(eq(pushDevices.ownerId, ownerId), ne(pushDevices.environment, "pull")))
    .orderBy(asc(pushDevices.createdAt))
    .limit(MAX_DEVICES_PER_OWNER);
  return rows.map((row) => ({ token: row.token, environment: row.environment === "production" ? "production" : "development" }));
}

const DEVICE_ACTIVE_MS = 21 * 24 * 60 * 60_000;

/** How many of the account's devices have checked in lately. */
export async function countPushDevices(ownerId: string, now = Date.now()) {
  const rows = await getDb()
    .select({ token: pushDevices.token })
    .from(pushDevices)
    .where(and(eq(pushDevices.ownerId, ownerId), gt(pushDevices.seenAt, new Date(now - DEVICE_ACTIVE_MS).toISOString())));
  return rows.length;
}

const NOTICE_TTL_MS = 24 * 60 * 60_000;
/** A notice older than this is no longer news: it is not shown late. */
export const NOTICE_FRESH_MS = 3 * 60 * 60_000;

/** Leaves a notice for the owner's devices; resolves to how many devices collect notices. */
export async function leaveOwnerNotice(ownerId: string, note: { title: string; body: string }, delivered: boolean, now = Date.now()) {
  const db = getDb();
  await db.delete(ownerNotices).where(and(eq(ownerNotices.ownerId, ownerId), lt(ownerNotices.createdAt, new Date(now - NOTICE_TTL_MS).toISOString())));
  await db.insert(ownerNotices).values({
    id: crypto.randomUUID(),
    ownerId,
    title: note.title.slice(0, 120),
    body: note.body.slice(0, 1_800),
    delivered,
    createdAt: new Date(now).toISOString(),
  });
  return countPushDevices(ownerId, now);
}

/**
 * The notices a device has not shown yet: newer than its cursor, still fresh,
 * oldest first. A phone leaves out what already reached it as a text.
 */
export async function pendingNotices(ownerId: string, options: { since: string | null; skipDelivered: boolean; now?: number }) {
  const now = options.now ?? Date.now();
  const freshFrom = new Date(now - NOTICE_FRESH_MS).toISOString();
  const from = options.since && options.since > freshFrom ? options.since : freshFrom;
  const rows = await getDb()
    .select({ id: ownerNotices.id, title: ownerNotices.title, body: ownerNotices.body, delivered: ownerNotices.delivered, createdAt: ownerNotices.createdAt })
    .from(ownerNotices)
    .where(and(eq(ownerNotices.ownerId, ownerId), gt(ownerNotices.createdAt, from)))
    .orderBy(desc(ownerNotices.createdAt))
    .limit(6);
  return rows
    .reverse()
    .filter((row) => !(options.skipDelivered && row.delivered))
    .map((row) => ({ id: row.id, title: row.title, body: row.body, createdAt: row.createdAt }));
}

export async function forgetPushDevice(token: string, ownerId?: string) {
  await getDb()
    .delete(pushDevices)
    .where(ownerId ? and(eq(pushDevices.token, token), eq(pushDevices.ownerId, ownerId)) : eq(pushDevices.token, token));
}

/** Accounts with a device to notify, leaving out anyone who turned Vox reaching out off. */
export async function listPushOwnerIds() {
  const db = getDb();
  const activeFrom = new Date(Date.now() - DEVICE_ACTIVE_MS).toISOString();
  const owners = [...new Set((await db.select({ ownerId: pushDevices.ownerId }).from(pushDevices).where(gt(pushDevices.seenAt, activeFrom)).limit(200)).map((row) => row.ownerId))];
  if (!owners.length) return [];
  const off = new Set(
    (await db.select({ ownerId: phoneAssistantSettings.ownerId }).from(phoneAssistantSettings).where(eq(phoneAssistantSettings.proactiveTexts, false))).map((row) => row.ownerId),
  );
  // The same accounts Vox may reach by text: this deployment's own.
  return owners.filter((ownerId) => !off.has(ownerId) && isPhoneAssistantOwner(ownerId)).slice(0, 50);
}
