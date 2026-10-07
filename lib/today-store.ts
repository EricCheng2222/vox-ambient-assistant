import { and, eq, inArray, lt } from "drizzle-orm";

import { getDb } from "@/db";
import { mailTriage, todayNowCache } from "@/db/schema";
import { isMailCategory, type MailCategory } from "@/lib/mail-category";
import type { MailVerdict } from "@/lib/today-moments";

// What the Today briefing remembers between loads, so JEV is asked once:
// the verdict on each unread email, and the last "now" decision. No email
// content is stored: a message is known only by a hash of its id.

const VERDICT_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_KEYS = 4;

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** The row id for one owner's message: neither can be read back from it. */
function verdictId(ownerId: string, messageId: string) {
  return sha256(`mail-triage:${ownerId}:${messageId}`);
}

function isVerdict(value: string): value is MailVerdict {
  return value === "needs_you" || value === "worth_reading" || value === "skip";
}

/** Stored verdicts for these message ids (at most 20 are asked for at once). */
export async function loadMailVerdicts(ownerId: string, messageIds: string[]): Promise<Map<string, MailVerdict>> {
  const verdicts = new Map<string, MailVerdict>();
  const ids = messageIds.slice(0, 50);
  if (!ids.length) return verdicts;
  const byRow = new Map(await Promise.all(ids.map(async (id) => [await verdictId(ownerId, id), id] as const)));
  const rows = await getDb()
    .select({ id: mailTriage.id, verdict: mailTriage.verdict })
    .from(mailTriage)
    .where(and(eq(mailTriage.ownerId, ownerId), inArray(mailTriage.id, [...byRow.keys()])));
  for (const row of rows) {
    const messageId = byRow.get(row.id);
    if (messageId && isVerdict(row.verdict)) verdicts.set(messageId, row.verdict);
  }
  return verdicts;
}

/** Stores new verdicts and drops this owner's verdicts older than 30 days. */
export async function saveMailVerdicts(ownerId: string, verdicts: Map<string, MailVerdict>, now = new Date()) {
  const entries = [...verdicts].slice(0, 20);
  if (!entries.length) return;
  const judgedAt = now.toISOString();
  const rows = await Promise.all(
    entries.map(async ([messageId, verdict]) => ({ id: await verdictId(ownerId, messageId), ownerId, verdict, judgedAt })),
  );
  const db = getDb();
  await db.insert(mailTriage).values(rows).onConflictDoNothing();
  await db
    .delete(mailTriage)
    .where(and(eq(mailTriage.ownerId, ownerId), lt(mailTriage.judgedAt, new Date(now.getTime() - VERDICT_TTL_MS).toISOString())));
}

/** Categories share the table with verdicts, under their own row ids. */
function categoryId(ownerId: string, messageId: string) {
  return sha256(`mail-category:${ownerId}:${messageId}`);
}

export async function loadMailCategories(ownerId: string, messageIds: string[]): Promise<Map<string, MailCategory>> {
  const categories = new Map<string, MailCategory>();
  const ids = messageIds.slice(0, 50);
  if (!ids.length) return categories;
  const byRow = new Map(await Promise.all(ids.map(async (id) => [await categoryId(ownerId, id), id] as const)));
  const rows = await getDb()
    .select({ id: mailTriage.id, verdict: mailTriage.verdict })
    .from(mailTriage)
    .where(and(eq(mailTriage.ownerId, ownerId), inArray(mailTriage.id, [...byRow.keys()])));
  for (const row of rows) {
    const messageId = byRow.get(row.id);
    if (messageId && isMailCategory(row.verdict)) categories.set(messageId, row.verdict);
  }
  return categories;
}

/** Stored beside the verdicts; the 30-day clean-up there covers these rows too. */
export async function saveMailCategories(ownerId: string, categories: Map<string, MailCategory>, now = new Date()) {
  const entries = [...categories].slice(0, 20);
  if (!entries.length) return;
  const judgedAt = now.toISOString();
  const rows = await Promise.all(
    entries.map(async ([messageId, verdict]) => ({ id: await categoryId(ownerId, messageId), ownerId, verdict, judgedAt })),
  );
  await getDb().insert(mailTriage).values(rows).onConflictDoNothing();
}

/** The owner's last "now" decision: the candidate-set signature it was made for and the chosen keys. */
export async function loadNowDecision(ownerId: string): Promise<{ signature: string; keys: string[] } | null> {
  const [row] = await getDb().select().from(todayNowCache).where(eq(todayNowCache.ownerId, ownerId)).limit(1);
  if (!row) return null;
  let keys: unknown;
  try {
    keys = JSON.parse(row.chosen);
  } catch {
    return null;
  }
  if (!Array.isArray(keys)) return null;
  return { signature: row.signature, keys: keys.filter((key): key is string => typeof key === "string").slice(0, MAX_KEYS) };
}

export async function saveNowDecision(ownerId: string, decision: { signature: string; keys: string[] }, now = new Date()) {
  const values = { signature: decision.signature, chosen: JSON.stringify(decision.keys.slice(0, MAX_KEYS)), decidedAt: now.toISOString() };
  await getDb()
    .insert(todayNowCache)
    .values({ ownerId, ...values })
    .onConflictDoUpdate({ target: todayNowCache.ownerId, set: values });
}

/** A short, fixed-length form of a candidate signature, for storage. */
export function signatureDigest(signature: string) {
  return sha256(`today-now:${signature}`);
}
