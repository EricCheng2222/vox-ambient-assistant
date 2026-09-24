import { and, eq, gt, sql } from "drizzle-orm";

import { getDb } from "../db/index.ts";
import {
  phoneAssistantSettings,
  phoneCallSessions,
} from "../db/schema.ts";
import {
  isValidSpokenPassphrase,
  normalizePhoneNumber,
  normalizeSpokenPassphrase,
} from "./phone-assistant-policy.ts";

export {
  isValidSpokenPassphrase,
  normalizePhoneNumber,
} from "./phone-assistant-policy.ts";

const encoder = new TextEncoder();
export const PHONE_ASSISTANT_OWNER_ID = "owner";

function isPhoneAssistantOwner(ownerId: string) {
  return ownerId === PHONE_ASSISTANT_OWNER_ID;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secretValue() {
  const secret =
    process.env.VOX_CONTACT_SECRET?.trim() ||
    process.env.VOX_SESSION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-phone-secret" : "");
  if (!secret) throw new Error("Vox phone security is not configured.");
  return secret;
}

async function encryptionKey() {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secretValue()));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secretValue()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function phoneHash(phoneNumber: string) {
  return hmac(`phone:${phoneNumber}`);
}

async function passphraseHash(passphrase: string) {
  return hmac(`spoken-passphrase:${normalizeSpokenPassphrase(passphrase)}`);
}

async function callerHash(from: string, callSid: string) {
  const normalized = normalizePhoneNumber(from);
  return hmac(`caller:${normalized ?? `anonymous:${callSid}`}`);
}

async function encryptPhone(phoneNumber: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    encoder.encode(phoneNumber),
  );
  return {
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptPhone(ciphertext: string, iv: string) {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    await encryptionKey(),
    base64UrlToBytes(ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

export async function savePhoneAssistantSettings(
  ownerId: string,
  passphrase: string,
  callbackPhoneNumber?: string | null,
) {
  if (!isPhoneAssistantOwner(ownerId)) throw new Error("Phone access is owner-only.");
  if (!isValidSpokenPassphrase(passphrase)) throw new Error("Invalid spoken passphrase.");
  const normalizedPhone = callbackPhoneNumber?.trim()
    ? normalizePhoneNumber(callbackPhoneNumber)
    : null;
  if (callbackPhoneNumber?.trim() && !normalizedPhone) {
    throw new Error("Invalid callback number.");
  }
  const encrypted = normalizedPhone ? await encryptPhone(normalizedPhone) : null;
  const normalizedPhrase = normalizeSpokenPassphrase(passphrase);
  const now = new Date().toISOString();
  await getDb()
    .insert(phoneAssistantSettings)
    .values({
      ownerId,
      passphraseHash: await passphraseHash(passphrase),
      passphraseLength: normalizedPhrase.length,
      phoneHash: normalizedPhone ? await phoneHash(normalizedPhone) : null,
      phoneCiphertext: encrypted?.ciphertext ?? null,
      phoneIv: encrypted?.iv ?? null,
      phoneLastFour: normalizedPhone?.slice(-4) ?? null,
      enabled: true,
      allowOutbound: false,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: phoneAssistantSettings.ownerId,
      set: {
        passphraseHash: await passphraseHash(passphrase),
        passphraseLength: normalizedPhrase.length,
        phoneHash: normalizedPhone ? await phoneHash(normalizedPhone) : null,
        phoneCiphertext: encrypted?.ciphertext ?? null,
        phoneIv: encrypted?.iv ?? null,
        phoneLastFour: normalizedPhone?.slice(-4) ?? null,
        enabled: true,
        allowOutbound: false,
        updatedAt: now,
      },
    });
  return getPhoneAssistantSettings(ownerId);
}

export async function getPhoneAssistantSettings(ownerId: string) {
  if (!isPhoneAssistantOwner(ownerId)) return null;
  const [record] = await getDb()
    .select({
      phoneLastFour: phoneAssistantSettings.phoneLastFour,
      passphraseHash: phoneAssistantSettings.passphraseHash,
      passphraseLength: phoneAssistantSettings.passphraseLength,
      enabled: phoneAssistantSettings.enabled,
      allowOutbound: phoneAssistantSettings.allowOutbound,
    })
    .from(phoneAssistantSettings)
    .where(eq(phoneAssistantSettings.ownerId, ownerId))
    .limit(1);
  return record?.passphraseHash ? record : null;
}

export async function getPhoneAssistantDestination(ownerId: string) {
  if (!isPhoneAssistantOwner(ownerId)) return null;
  const [record] = await getDb()
    .select({
      phoneCiphertext: phoneAssistantSettings.phoneCiphertext,
      phoneIv: phoneAssistantSettings.phoneIv,
      enabled: phoneAssistantSettings.enabled,
      allowOutbound: phoneAssistantSettings.allowOutbound,
    })
    .from(phoneAssistantSettings)
    .where(eq(phoneAssistantSettings.ownerId, ownerId))
    .limit(1);
  if (
    !record?.enabled ||
    !record.allowOutbound ||
    !record.phoneCiphertext ||
    !record.phoneIv
  ) return null;
  return decryptPhone(record.phoneCiphertext, record.phoneIv);
}

export async function updatePhoneAssistantOptions(
  ownerId: string,
  patch: { enabled?: boolean; allowOutbound?: boolean },
) {
  if (!isPhoneAssistantOwner(ownerId)) return null;
  await getDb()
    .update(phoneAssistantSettings)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(phoneAssistantSettings.ownerId, ownerId));
  return getPhoneAssistantSettings(ownerId);
}

export async function deletePhoneAssistantSettings(ownerId: string) {
  if (!isPhoneAssistantOwner(ownerId)) return;
  await getDb().delete(phoneCallSessions).where(eq(phoneCallSessions.ownerId, ownerId));
  await getDb().delete(phoneAssistantSettings).where(eq(phoneAssistantSettings.ownerId, ownerId));
}

export async function beginPhoneCall(callSid: string, from: string) {
  const now = new Date();
  const fingerprint = await callerHash(from, callSid);
  const oneHourAgo = new Date(now.getTime() - 60 * 60_000).toISOString();
  const [{ count }] = await getDb()
    .select({ count: sql<number>`count(*)` })
    .from(phoneCallSessions)
    .where(
      and(
        eq(phoneCallSessions.callerHash, fingerprint),
        eq(phoneCallSessions.status, "failed"),
        gt(phoneCallSessions.createdAt, oneHourAgo),
      ),
    );
  if (Number(count) >= 5) return false;
  await getDb()
    .insert(phoneCallSessions)
    .values({
      callSid,
      ownerId: null,
      callerHash: fingerprint,
      status: "pending_phrase",
      failedAttempts: 0,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    })
    .onConflictDoUpdate({
      target: phoneCallSessions.callSid,
      set: { updatedAt: now.toISOString() },
    });
  return true;
}

export async function verifyPhoneCallPassphrase(callSid: string, passphrase: string) {
  const now = new Date().toISOString();
  const [session] = await getDb()
    .select({
      failedAttempts: phoneCallSessions.failedAttempts,
    })
    .from(phoneCallSessions)
    .where(
      and(
        eq(phoneCallSessions.callSid, callSid),
        eq(phoneCallSessions.status, "pending_phrase"),
        gt(phoneCallSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!session || session.failedAttempts >= 1 || !isValidSpokenPassphrase(passphrase)) return null;
  const [setting] = await getDb()
    .select({ ownerId: phoneAssistantSettings.ownerId })
    .from(phoneAssistantSettings)
    .where(
      and(
        eq(phoneAssistantSettings.ownerId, PHONE_ASSISTANT_OWNER_ID),
        eq(phoneAssistantSettings.passphraseHash, await passphraseHash(passphrase)),
        eq(phoneAssistantSettings.enabled, true),
      ),
    )
    .limit(1);
  await getDb()
    .update(phoneCallSessions)
    .set({
      ownerId: setting?.ownerId ?? null,
      status: setting ? "authenticated" : "failed",
      failedAttempts: setting ? session.failedAttempts : session.failedAttempts + 1,
      updatedAt: now,
      expiresAt: setting
        ? new Date(Date.now() + 2 * 60 * 60_000).toISOString()
        : now,
    })
    .where(eq(phoneCallSessions.callSid, callSid));
  return setting?.ownerId ?? null;
}

export async function authenticatedPhoneCallOwner(callSid: string) {
  const [record] = await getDb()
    .select({ ownerId: phoneCallSessions.ownerId })
    .from(phoneCallSessions)
    .where(
      and(
        eq(phoneCallSessions.callSid, callSid),
        eq(phoneCallSessions.ownerId, PHONE_ASSISTANT_OWNER_ID),
        eq(phoneCallSessions.status, "authenticated"),
        gt(phoneCallSessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);
  return record?.ownerId ?? null;
}

export async function endPhoneCall(callSid: string) {
  await getDb().delete(phoneCallSessions).where(eq(phoneCallSessions.callSid, callSid));
  await getDb().run(sql`DELETE FROM phone_call_sessions WHERE expires_at <= ${new Date().toISOString()}`);
}
