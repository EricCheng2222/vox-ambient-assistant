import { and, asc, eq, isNull, lte } from "drizzle-orm";

import { getDb } from "@/db";
import { reminders } from "@/db/schema";
import type { Reminder, ReminderStatus } from "@/lib/reminder";

const publicReminder = {
  id: reminders.id,
  title: reminders.title,
  notes: reminders.notes,
  dueAt: reminders.dueAt,
  status: reminders.status,
  source: reminders.source,
  notifiedAt: reminders.notifiedAt,
  createdAt: reminders.createdAt,
  updatedAt: reminders.updatedAt,
};

export async function listReminders(
  ownerId: string,
  limit = 80,
): Promise<Reminder[]> {
  return getDb()
    .select(publicReminder)
    .from(reminders)
    .where(eq(reminders.ownerId, ownerId))
    .orderBy(asc(reminders.dueAt))
    .limit(limit) as Promise<Reminder[]>;
}

export async function createReminder(
  ownerId: string,
  input: {
    title: string;
    notes?: string | null;
    dueAt: string;
  },
) {
  const now = new Date().toISOString();
  const [reminder] = await getDb()
    .insert(reminders)
    .values({
      id: crypto.randomUUID(),
      ownerId,
      title: input.title,
      notes: input.notes ?? null,
      dueAt: input.dueAt,
      status: "pending",
      source: "conversation",
      notifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning(publicReminder);
  return reminder as Reminder;
}

export async function updateReminderStatus(
  ownerId: string,
  id: string,
  status: ReminderStatus,
) {
  const [reminder] = await getDb()
    .update(reminders)
    .set({
      status,
      notifiedAt: status === "pending" ? null : undefined,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, id)))
    .returning(publicReminder);
  return (reminder ?? null) as Reminder | null;
}

export async function deleteReminder(ownerId: string, id: string) {
  const [deleted] = await getDb()
    .delete(reminders)
    .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, id)))
    .returning({ id: reminders.id });
  return deleted?.id ?? null;
}

export async function claimDueReminders(ownerId: string, now = new Date()) {
  const notifiedAt = now.toISOString();
  return getDb()
    .update(reminders)
    .set({ notifiedAt, updatedAt: notifiedAt })
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.status, "pending"),
        isNull(reminders.notifiedAt),
        lte(reminders.dueAt, notifiedAt),
      ),
    )
    .returning(publicReminder) as Promise<Reminder[]>;
}
