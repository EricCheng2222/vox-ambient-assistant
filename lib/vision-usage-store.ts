import { and, eq, isNull, lt, lte, ne, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { visionUsage } from "@/db/schema";

export const VISION_HOURLY_ANALYSIS_LIMIT = 30;
export const VISION_DAILY_ANALYSIS_LIMIT = 120;
export const VISION_MINIMUM_INTERVAL_MS = 3_000;

function buckets(now: Date) {
  const iso = now.toISOString();
  return { hourBucket: iso.slice(0, 13), dayBucket: iso.slice(0, 10) };
}

async function ensureUsage(ownerId: string) {
  const db = getDb();
  await db
    .insert(visionUsage)
    .values({ ownerId })
    .onConflictDoNothing({ target: visionUsage.ownerId });
}

export async function claimVisionAnalysis(ownerId: string, now = new Date()) {
  await ensureUsage(ownerId);
  const db = getDb();
  const { hourBucket, dayBucket } = buckets(now);
  const nowIso = now.toISOString();
  const cutoffIso = new Date(
    now.getTime() - VISION_MINIMUM_INTERVAL_MS,
  ).toISOString();
  const [claimed] = await db
    .update(visionUsage)
    .set({
      hourBucket,
      hourCount: sql<number>`CASE WHEN ${visionUsage.hourBucket} = ${hourBucket} THEN ${visionUsage.hourCount} + 1 ELSE 1 END`,
      dayBucket,
      dayCount: sql<number>`CASE WHEN ${visionUsage.dayBucket} = ${dayBucket} THEN ${visionUsage.dayCount} + 1 ELSE 1 END`,
      lastAnalysisAt: nowIso,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .where(
      and(
        eq(visionUsage.ownerId, ownerId),
        or(
          ne(visionUsage.hourBucket, hourBucket),
          lt(visionUsage.hourCount, VISION_HOURLY_ANALYSIS_LIMIT),
        ),
        or(
          ne(visionUsage.dayBucket, dayBucket),
          lt(visionUsage.dayCount, VISION_DAILY_ANALYSIS_LIMIT),
        ),
        or(
          isNull(visionUsage.lastAnalysisAt),
          lte(visionUsage.lastAnalysisAt, cutoffIso),
        ),
      ),
    )
    .returning({
      hourCount: visionUsage.hourCount,
      dayCount: visionUsage.dayCount,
    });

  if (!claimed) {
    const [record] = await db
      .select({
        hourBucket: visionUsage.hourBucket,
        hourCount: visionUsage.hourCount,
        dayBucket: visionUsage.dayBucket,
        dayCount: visionUsage.dayCount,
      })
      .from(visionUsage)
      .where(eq(visionUsage.ownerId, ownerId))
      .limit(1);
    if (record?.hourBucket === hourBucket && record.hourCount >= VISION_HOURLY_ANALYSIS_LIMIT) {
      return { allowed: false as const, reason: "hourly_limit" as const };
    }
    if (record?.dayBucket === dayBucket && record.dayCount >= VISION_DAILY_ANALYSIS_LIMIT) {
      return { allowed: false as const, reason: "daily_limit" as const };
    }
    return { allowed: false as const, reason: "rate_limited" as const };
  }

  return {
    allowed: true as const,
    remainingHour: VISION_HOURLY_ANALYSIS_LIMIT - claimed.hourCount,
    remainingDay: VISION_DAILY_ANALYSIS_LIMIT - claimed.dayCount,
  };
}
