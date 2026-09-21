import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { socialInteractionState } from "@/db/schema";
import type { ConversationRitual, MemoryUse } from "@/lib/social-policy";
import { USER_TIME_ZONE } from "@/lib/time-context";

const NATURAL_CALLBACK_COOLDOWN_MS = 36 * 60 * 60 * 1000;
const EMOTIONAL_FOLLOWUP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type SocialState = {
  lastMorningDate: string | null;
  lastNightDate: string | null;
  lastNaturalCallbackAt: string | null;
  lastEmotionalFollowupAt: string | null;
};

export type SocialEligibility = {
  localDate: string;
  localHour: number;
  morning: boolean;
  night: boolean;
  naturalCallback: boolean;
  emotionalFollowup: boolean;
};

function localDateAndHour(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: USER_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    localDate: `${value("year")}-${value("month")}-${value("day")}`,
    localHour: Number(value("hour")),
  };
}

function cooldownReady(value: string | null, now: Date, cooldownMs: number) {
  if (!value) return true;
  const previous = Date.parse(value);
  return !Number.isFinite(previous) || now.getTime() - previous >= cooldownMs;
}

export async function getSocialEligibility(
  ownerId: string,
  now = new Date(),
): Promise<SocialEligibility> {
  const [record] = await getDb()
    .select({
      lastMorningDate: socialInteractionState.lastMorningDate,
      lastNightDate: socialInteractionState.lastNightDate,
      lastNaturalCallbackAt: socialInteractionState.lastNaturalCallbackAt,
      lastEmotionalFollowupAt: socialInteractionState.lastEmotionalFollowupAt,
    })
    .from(socialInteractionState)
    .where(eq(socialInteractionState.ownerId, ownerId))
    .limit(1);
  const state: SocialState = record ?? {
    lastMorningDate: null,
    lastNightDate: null,
    lastNaturalCallbackAt: null,
    lastEmotionalFollowupAt: null,
  };
  const { localDate, localHour } = localDateAndHour(now);

  return {
    localDate,
    localHour,
    morning:
      localHour >= 5 && localHour < 12 && state.lastMorningDate !== localDate,
    night:
      (localHour >= 20 || localHour < 3) && state.lastNightDate !== localDate,
    naturalCallback: cooldownReady(
      state.lastNaturalCallbackAt,
      now,
      NATURAL_CALLBACK_COOLDOWN_MS,
    ),
    emotionalFollowup: cooldownReady(
      state.lastEmotionalFollowupAt,
      now,
      EMOTIONAL_FOLLOWUP_COOLDOWN_MS,
    ),
  };
}

export async function recordSocialDecision(
  ownerId: string,
  decision: { ritual: ConversationRitual; memoryUse: MemoryUse },
  localDate: string,
  now = new Date(),
) {
  if (decision.ritual === "none" && decision.memoryUse === "none") return;
  const db = getDb();
  await db
    .insert(socialInteractionState)
    .values({ ownerId })
    .onConflictDoNothing({ target: socialInteractionState.ownerId });

  const update: Partial<typeof socialInteractionState.$inferInsert> = {
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  if (decision.ritual === "good_morning") update.lastMorningDate = localDate;
  if (decision.ritual === "good_night") update.lastNightDate = localDate;
  if (decision.memoryUse === "natural_callback") {
    update.lastNaturalCallbackAt = now.toISOString();
  }
  if (decision.memoryUse === "emotional_followup") {
    update.lastEmotionalFollowupAt = now.toISOString();
  }

  await db
    .update(socialInteractionState)
    .set(update)
    .where(eq(socialInteractionState.ownerId, ownerId));
}
