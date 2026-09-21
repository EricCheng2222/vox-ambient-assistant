import { and, asc, eq, isNull, lte } from "drizzle-orm";

import { getDb } from "@/db";
import { reminders } from "@/db/schema";
import type { Reminder, ReminderStatus } from "@/lib/reminder";

export async function listReminders(limit = 80): Promise<Reminder[]> {
  return getDb()
    .select()
    .from(reminders)
    .orderBy(asc(reminders.dueAt))
    .limit(limit) as Promise<Reminder[]>;
}

export async function createReminder(input: {
  title: string;
  notes?: string | null;
  dueAt: string;
}) {
  const now = new Date().toISOString();
  const [reminder] = await getDb()
    .insert(reminders)
    .values({
      id: crypto.randomUUID(),
      title: input.title,
      notes: input.notes ?? null,
      dueAt: input.dueAt,
      status: "pending",
      source: "conversation",
      notifiedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return reminder as Reminder;
}

export async function updateReminderStatus(id: string, status: ReminderStatus) {
  const [reminder] = await getDb()
    .update(reminders)
    .set({
      status,
      notifiedAt: status === "pending" ? null : undefined,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(reminders.id, id))
    .returning();
  return (reminder ?? null) as Reminder | null;
}

export async function deleteReminder(id: string) {
  const [deleted] = await getDb()
    .delete(reminders)
    .where(eq(reminders.id, id))
    .returning({ id: reminders.id });
  return deleted?.id ?? null;
}

export async function claimDueReminders(now = new Date()) {
  const notifiedAt = now.toISOString();
  return getDb()
    .update(reminders)
    .set({ notifiedAt, updatedAt: notifiedAt })
    .where(
      and(
        eq(reminders.status, "pending"),
        isNull(reminders.notifiedAt),
        lte(reminders.dueAt, notifiedAt),
      ),
    )
    .returning() as Promise<Reminder[]>;
}
