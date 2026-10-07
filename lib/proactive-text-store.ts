import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";

import { getDb } from "@/db";
import { proactiveTextKeys, proactiveTextLog } from "@/db/schema";
import type { ProactiveTextStore } from "@/lib/proactive-tick";
import type { TextKind, TextLogRow, TextStatus } from "@/lib/proactive-texts";

// What the background check remembers (see lib/proactive-tick.ts): which
// things it has already dealt with, by a hash of their key, and a log of the
// texts it set out to send. No subject, title, address, phone number, or
// message text is stored here.

const LOG_TTL_MS = 30 * 24 * 60 * 60_000;
const KINDS = new Set<string>(["nudge", "morning", "evening"]);
const STATUSES = new Set<string>(["sending", "sent", "error", "skipped"]);

export const proactiveTextStore: ProactiveTextStore = {
  async loadKeys(ownerId, ids) {
    const known = new Map<string, { seenAt: string }>();
    const wanted = ids.slice(0, 80);
    if (!wanted.length) return known;
    const rows = await getDb()
      .select({ id: proactiveTextKeys.id, seenAt: proactiveTextKeys.seenAt })
      .from(proactiveTextKeys)
      .where(and(eq(proactiveTextKeys.ownerId, ownerId), inArray(proactiveTextKeys.id, wanted)));
    for (const row of rows) known.set(row.id, { seenAt: row.seenAt });
    return known;
  },

  async claimKeys(ownerId, keys, nowIso) {
    const claimed: string[] = [];
    // One row at a time, so each answer says whether this caller got that key.
    for (const key of keys.slice(0, 40)) {
      const rows = await getDb()
        .insert(proactiveTextKeys)
        .values({ id: key.id, ownerId, kind: key.kind, status: key.status, createdAt: nowIso, seenAt: nowIso })
        .onConflictDoNothing({ target: proactiveTextKeys.id })
        .returning({ id: proactiveTextKeys.id });
      if (rows.length) claimed.push(key.id);
    }
    return claimed;
  },

  async releaseKeys(ownerId, ids) {
    if (!ids.length) return;
    await getDb()
      .delete(proactiveTextKeys)
      .where(and(eq(proactiveTextKeys.ownerId, ownerId), inArray(proactiveTextKeys.id, ids.slice(0, 40))));
  },

  async touchKeys(ownerId, ids, nowIso, pruneBeforeIso) {
    const db = getDb();
    if (ids.length) {
      await db
        .update(proactiveTextKeys)
        .set({ seenAt: nowIso })
        .where(and(eq(proactiveTextKeys.ownerId, ownerId), inArray(proactiveTextKeys.id, ids.slice(0, 80))));
    }
    await db.delete(proactiveTextKeys).where(and(eq(proactiveTextKeys.ownerId, ownerId), lt(proactiveTextKeys.seenAt, pruneBeforeIso)));
    await db
      .delete(proactiveTextLog)
      .where(and(eq(proactiveTextLog.ownerId, ownerId), lt(proactiveTextLog.createdAt, new Date(Date.parse(nowIso) - LOG_TTL_MS).toISOString())));
  },

  async recentLog(ownerId, sinceIso) {
    const rows = await getDb()
      .select({
        kind: proactiveTextLog.kind,
        status: proactiveTextLog.status,
        localDay: proactiveTextLog.localDay,
        createdAt: proactiveTextLog.createdAt,
      })
      .from(proactiveTextLog)
      .where(and(eq(proactiveTextLog.ownerId, ownerId), gte(proactiveTextLog.createdAt, sinceIso)))
      .limit(200);
    return rows.filter((row) => KINDS.has(row.kind) && STATUSES.has(row.status)) as TextLogRow[];
  },

  async claimLog(row) {
    const rows = await getDb()
      .insert(proactiveTextLog)
      .values(row)
      .onConflictDoNothing({ target: proactiveTextLog.id })
      .returning({ id: proactiveTextLog.id });
    return rows.length > 0;
  },

  async finishLog(id, status, error) {
    await getDb().update(proactiveTextLog).set({ status, error }).where(eq(proactiveTextLog.id, id));
  },
};

/** The last text Vox set out to send on its own and how it went; null when there is none. */
export async function lastProactiveText(ownerId: string) {
  const [row] = await getDb()
    .select({ kind: proactiveTextLog.kind, status: proactiveTextLog.status, createdAt: proactiveTextLog.createdAt })
    .from(proactiveTextLog)
    .where(and(eq(proactiveTextLog.ownerId, ownerId), inArray(proactiveTextLog.status, ["sent", "error"])))
    .orderBy(desc(proactiveTextLog.createdAt))
    .limit(1);
  if (!row || !KINDS.has(row.kind)) return null;
  return { kind: row.kind as TextKind, ok: (row.status as TextStatus) === "sent", at: row.createdAt };
}
