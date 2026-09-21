import { eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { userPreferences } from "@/db/schema";
import {
  defaultUserPreferences,
  parseUserPreferences,
  type UserPreferences,
} from "@/lib/preferences";

export async function getUserPreferences(
  ownerId: string,
): Promise<UserPreferences> {
  return (await getUserPreferencesState(ownerId)).preferences;
}

export async function getUserPreferencesState(
  ownerId: string,
): Promise<{ preferences: UserPreferences; stored: boolean }> {
  const [record] = await getDb()
    .select({
      replyLength: userPreferences.replyLength,
      voice: userPreferences.voice,
      initiative: userPreferences.initiative,
    })
    .from(userPreferences)
    .where(eq(userPreferences.ownerId, ownerId))
    .limit(1);

  return {
    preferences: record ? parseUserPreferences(record) : defaultUserPreferences,
    stored: Boolean(record),
  };
}

export async function updateUserPreferences(
  ownerId: string,
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> {
  const db = getDb();
  await db
    .insert(userPreferences)
    .values({ ownerId, ...defaultUserPreferences })
    .onConflictDoNothing({ target: userPreferences.ownerId });

  const update: Partial<typeof userPreferences.$inferInsert> = {
    updatedAt: sql`CURRENT_TIMESTAMP`,
  };
  if (patch.replyLength !== undefined) update.replyLength = patch.replyLength;
  if (patch.voice !== undefined) update.voice = patch.voice;
  if (patch.initiative !== undefined) update.initiative = patch.initiative;

  await db
    .update(userPreferences)
    .set(update)
    .where(eq(userPreferences.ownerId, ownerId));

  return getUserPreferences(ownerId);
}
