import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { userProfiles } from "@/db/schema";
import {
  getConversationTurnsSince,
  latestConversationSequence,
  listConversationOwnerIds,
} from "@/lib/conversation-store";
import { listMemories } from "@/lib/memory-store";
import {
  emptyProfile,
  forgetText,
  formatProfileContext,
  parseProfile,
  type OwnerProfile,
} from "@/lib/profile";
import type { ProfileJobStore, ProfileRunRecord, ProfileState } from "@/lib/profile-consolidate";
import { isValidTimeZone } from "@/lib/profile-schedule";

// The owner profile and the nightly run's bookkeeping. The profile is stored
// encrypted, with its own key, and only opens for the owner it was written for.

type ProfileRow = typeof userProfiles.$inferSelect;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function profileKey() {
  const secret =
    process.env.VOX_CONVERSATION_SECRET?.trim() ||
    (process.env.NODE_ENV !== "production" ? "vox-local-conversation-secret" : "");
  if (!secret) throw new Error("Vox profile security is not configured.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`owner-profile:${secret}`));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptProfile(profile: OwnerProfile, ownerId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(ownerId) },
    await profileKey(),
    new TextEncoder().encode(JSON.stringify(profile)),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

async function decryptProfile(row: ProfileRow | undefined): Promise<OwnerProfile> {
  if (!row?.ciphertext || !row.iv) return emptyProfile();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(row.iv), additionalData: new TextEncoder().encode(row.ownerId) },
    await profileKey(),
    base64UrlToBytes(row.ciphertext),
  );
  return parseProfile(JSON.parse(new TextDecoder().decode(plaintext)));
}

async function loadRow(ownerId: string) {
  const [row] = await getDb().select().from(userProfiles).where(eq(userProfiles.ownerId, ownerId)).limit(1);
  return row;
}

async function ensureRow(ownerId: string) {
  await getDb().insert(userProfiles).values({ ownerId }).onConflictDoNothing({ target: userProfiles.ownerId });
}

export async function loadProfileState(ownerId: string): Promise<ProfileState> {
  const row = await loadRow(ownerId);
  return {
    profile: await decryptProfile(row),
    timeZone: row?.timeZone ?? null,
    lastSequence: row?.lastSequence ?? 0,
    consolidatedDay: row?.consolidatedDay ?? null,
  };
}

/** Everything the profile page shows. */
export async function getProfileOverview(ownerId: string, now = new Date()) {
  const row = await loadRow(ownerId);
  const claimAge = row?.runStartedAt ? now.getTime() - Date.parse(row.runStartedAt) : Number.POSITIVE_INFINITY;
  return {
    profile: await decryptProfile(row),
    timeZone: row?.timeZone ?? null,
    timeZoneSource: row?.timeZoneSource ?? null,
    updatedAt: row?.lastSuccessAt ?? null,
    running: claimAge >= 0 && claimAge < 15 * 60_000,
    manualRunAt: row?.manualRunAt ?? null,
    lastRun: row?.lastRunAt
      ? {
          at: row.lastRunAt,
          status: row.lastRunStatus === "error" ? ("error" as const) : ("ok" as const),
          trigger: row.lastRunTrigger === "manual" ? ("manual" as const) : ("nightly" as const),
          messages: row.lastRunMessages,
          error: row.lastRunError,
        }
      : null,
  };
}

async function writeProfile(ownerId: string, profile: OwnerProfile) {
  await ensureRow(ownerId);
  const encrypted = await encryptProfile(profile, ownerId);
  await getDb()
    .update(userProfiles)
    .set({ ...encrypted, updatedAt: new Date().toISOString() })
    .where(eq(userProfiles.ownerId, ownerId));
}

/** Reads the profile, applies a change, and saves it. Null leaves it as is. */
export async function changeProfile(
  ownerId: string,
  change: (profile: OwnerProfile) => OwnerProfile | null,
): Promise<OwnerProfile | null> {
  const next = change(await decryptProfile(await loadRow(ownerId)));
  if (!next) return null;
  await writeProfile(ownerId, next);
  return next;
}

/**
 * Erases everything Vox has learned: the facts, the digest, and the list of
 * forgotten things. The conversation so far is marked as read, so the next
 * nightly update starts from what is said after this moment.
 */
export async function eraseProfile(ownerId: string) {
  await ensureRow(ownerId);
  const lastSequence = await latestConversationSequence(ownerId).catch(() => 0);
  await getDb()
    .update(userProfiles)
    .set({
      ciphertext: null,
      iv: null,
      lastSequence: sql`MAX(${userProfiles.lastSequence}, ${lastSequence})`,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunTrigger: null,
      lastRunMessages: 0,
      lastRunError: null,
      lastSuccessAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(userProfiles.ownerId, ownerId));
}

/**
 * Something the user had Vox forget elsewhere (a saved memory). The profile
 * drops any fact that says the same thing and never learns it again.
 */
export async function forgetInProfile(ownerId: string, text: string) {
  await changeProfile(ownerId, (profile) => forgetText(profile, text, new Date().toISOString()));
}

/**
 * Records where the owner is. What their own device reports always wins; a
 * zone guessed from the network only fills in when the device never said.
 */
export async function noteTimeZone(ownerId: string, timeZone: unknown, source: "device" | "network") {
  if (!isValidTimeZone(timeZone)) return false;
  const now = new Date().toISOString();
  await getDb().run(sql`
    INSERT INTO user_profiles (owner_id, time_zone, time_zone_source, created_at, updated_at)
    VALUES (${ownerId}, ${timeZone}, ${source}, ${now}, ${now})
    ON CONFLICT(owner_id) DO UPDATE SET
      time_zone = excluded.time_zone,
      time_zone_source = excluded.time_zone_source,
      updated_at = excluded.updated_at
    WHERE (user_profiles.time_zone IS NULL OR user_profiles.time_zone != excluded.time_zone
        OR COALESCE(user_profiles.time_zone_source, '') != excluded.time_zone_source)
      AND (${source} = 'device' OR COALESCE(user_profiles.time_zone_source, '') != 'device')
  `);
  return true;
}

/** Takes the "Update now" slot; false when it was used too recently. */
export async function claimManualRun(ownerId: string, now: Date, intervalMs: number) {
  await ensureRow(ownerId);
  const result = await getDb().run(sql`
    UPDATE user_profiles
    SET manual_run_at = ${now.toISOString()}
    WHERE owner_id = ${ownerId}
      AND (manual_run_at IS NULL OR manual_run_at < ${new Date(now.getTime() - intervalMs).toISOString()})
  `);
  return Number(result.meta.changes ?? 0) > 0;
}

async function finishRun(
  ownerId: string,
  result: { profile?: OwnerProfile; lastSequence?: number; consolidatedDay?: string; run?: ProfileRunRecord },
) {
  const update: Partial<typeof userProfiles.$inferInsert> = {
    runStartedAt: null,
    updatedAt: new Date().toISOString(),
  };
  if (result.profile) Object.assign(update, await encryptProfile(result.profile, ownerId));
  if (result.lastSequence !== undefined) update.lastSequence = result.lastSequence;
  if (result.consolidatedDay !== undefined) update.consolidatedDay = result.consolidatedDay;
  if (result.run) {
    update.lastRunAt = result.run.at;
    update.lastRunStatus = result.run.status;
    update.lastRunTrigger = result.run.trigger;
    update.lastRunMessages = result.run.messages;
    update.lastRunError = result.run.error;
    if (result.run.status === "ok") update.lastSuccessAt = result.run.at;
  }
  await getDb().update(userProfiles).set(update).where(eq(userProfiles.ownerId, ownerId));
}

export const profileJobStore: ProfileJobStore = {
  loadState: loadProfileState,
  async claimRun(ownerId, nowIso, staleBeforeIso) {
    await ensureRow(ownerId);
    const result = await getDb().run(sql`
      UPDATE user_profiles
      SET run_started_at = ${nowIso}
      WHERE owner_id = ${ownerId}
        AND (run_started_at IS NULL OR run_started_at < ${staleBeforeIso})
    `);
    return Number(result.meta.changes ?? 0) > 0;
  },
  loadTurnsSince: getConversationTurnsSince,
  async loadSavedNotes(ownerId) {
    return (await listMemories(ownerId, 40)).map((memory) => memory.content);
  },
  finishRun,
};

/** Every account the nightly check should look at. */
export async function listProfileOwnerIds() {
  const [talkers, known] = await Promise.all([
    listConversationOwnerIds(),
    getDb().select({ ownerId: userProfiles.ownerId }).from(userProfiles).limit(500),
  ]);
  return [...new Set([...talkers, ...known.map((row) => row.ownerId)])];
}

/**
 * The profile as background for a model, or "" when there is none or it cannot
 * be read. Never throws: a conversation must start even if this fails.
 */
export async function loadProfileContext(ownerId: string, alreadyKnown: string[] = [], maxChars?: number) {
  try {
    const row = await loadRow(ownerId);
    if (!row?.ciphertext) return "";
    return formatProfileContext(await decryptProfile(row), { alreadyKnown, maxChars });
  } catch (error) {
    console.error("Continuing without the owner profile", error instanceof Error ? error.message : "");
    return "";
  }
}
