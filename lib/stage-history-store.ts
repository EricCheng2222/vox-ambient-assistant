import { and, desc, eq, notInArray, or } from "drizzle-orm";

import { getDb } from "@/db";
import { stageHistory } from "@/db/schema";
import type { StageContent } from "@/lib/stage";
import { MAX_STAGE_HISTORY, stageForHistory } from "@/lib/stage-history";

export async function recentStages(ownerId: string): Promise<StageContent[]> {
  const rows = await getDb()
    .select({ content: stageHistory.content })
    .from(stageHistory)
    .where(eq(stageHistory.ownerId, ownerId))
    .orderBy(desc(stageHistory.createdAt))
    .limit(MAX_STAGE_HISTORY);
  const stages: StageContent[] = [];
  for (const row of rows) {
    try {
      const stage = stageForHistory(JSON.parse(row.content));
      if (stage) stages.push(stage);
    } catch {
      // A row that no longer reads is skipped.
    }
  }
  return stages;
}

/** Keeps a stage (replacing an older one with the same title) and drops all but the newest few. */
export async function rememberStage(ownerId: string, stage: StageContent, nowIso: string) {
  const db = getDb();
  const id = `${ownerId}:${stage.id}`;
  await db.delete(stageHistory).where(and(eq(stageHistory.ownerId, ownerId), or(eq(stageHistory.id, id), eq(stageHistory.title, stage.title))));
  await db.insert(stageHistory).values({ id, ownerId, title: stage.title, content: JSON.stringify(stage), createdAt: nowIso });
  const keep = await db
    .select({ id: stageHistory.id })
    .from(stageHistory)
    .where(eq(stageHistory.ownerId, ownerId))
    .orderBy(desc(stageHistory.createdAt))
    .limit(MAX_STAGE_HISTORY);
  if (keep.length >= MAX_STAGE_HISTORY) {
    await db.delete(stageHistory).where(and(eq(stageHistory.ownerId, ownerId), notInArray(stageHistory.id, keep.map((row) => row.id))));
  }
}

export async function forgetStage(ownerId: string, stageId: string) {
  await getDb().delete(stageHistory).where(and(eq(stageHistory.ownerId, ownerId), eq(stageHistory.id, `${ownerId}:${stageId}`)));
}
