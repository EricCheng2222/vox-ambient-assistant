import { and, asc, eq, gt, gte, isNull, lt, lte, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { reminders } from "@/db/schema";
import {
  LOCATION_REMINDER_DUE_AT,
  type Reminder,
  type ReminderDelivery,
  type ReminderLocationStatus,
  type ReminderPlaceEvent,
  type ReminderStatus,
} from "@/lib/reminder";

const publicReminder = {
  id: reminders.id,
  title: reminders.title,
  notes: reminders.notes,
  dueAt: reminders.dueAt,
  status: reminders.status,
  source: reminders.source,
  notifiedAt: reminders.notifiedAt,
  delivery: reminders.delivery,
  callStatus: reminders.callStatus,
  calledAt: reminders.calledAt,
  triggerType: reminders.triggerType,
  place: reminders.place,
  placeEvent: reminders.placeEvent,
  locationStatus: reminders.locationStatus,
  createdAt: reminders.createdAt,
  updatedAt: reminders.updatedAt,
};

// Pending reminders stay listed, overdue or not, until the user completes or
// postpones them. Completed and dismissed reminders drop out once their time
// has passed.
export async function listReminders(
  ownerId: string,
  limit = 200,
): Promise<Reminder[]> {
  return getDb()
    .select(publicReminder)
    .from(reminders)
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        or(
          eq(reminders.status, "pending"),
          and(eq(reminders.triggerType, "time"), gt(reminders.dueAt, new Date().toISOString())),
        ),
      ),
    )
    .orderBy(asc(reminders.dueAt))
    .limit(limit) as Promise<Reminder[]>;
}

export async function createReminder(
  ownerId: string,
  input: {
    title: string;
    notes?: string | null;
    dueAt?: string;
    delivery?: ReminderDelivery;
    location?: { place: string; event: ReminderPlaceEvent };
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
      dueAt: input.location ? LOCATION_REMINDER_DUE_AT : (input.dueAt ?? LOCATION_REMINDER_DUE_AT),
      status: "pending",
      source: "conversation",
      notifiedAt: null,
      // Phone calls need a due time; location reminders alert on the iPhone.
      delivery: input.location ? "app" : (input.delivery ?? "app"),
      triggerType: input.location ? "location" : "time",
      place: input.location?.place ?? null,
      placeEvent: input.location?.event ?? null,
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
  const now = new Date().toISOString();
  const [reminder] = await getDb()
    .update(reminders)
    .set({
      status,
      // Reopening re-arms alerts only for a reminder that is not yet due, so an
      // undo never re-announces (or re-calls about) one that already fired.
      notifiedAt: status === "pending"
        ? sql`CASE WHEN ${reminders.dueAt} > ${now} THEN NULL ELSE ${reminders.notifiedAt} END`
        : undefined,
      updatedAt: now,
    })
    .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, id)))
    .returning(publicReminder);
  return (reminder ?? null) as Reminder | null;
}

export async function updateReminderDelivery(
  ownerId: string,
  id: string,
  delivery: ReminderDelivery,
) {
  const now = new Date().toISOString();
  // Only a pending, still-future reminder can change how it will be delivered.
  const [reminder] = await getDb()
    .update(reminders)
    .set({ delivery, callStatus: null, callAttempts: 0, calledAt: null, updatedAt: now })
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.id, id),
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "time"),
        gt(reminders.dueAt, now),
      ),
    )
    .returning(publicReminder);
  return (reminder ?? null) as Reminder | null;
}

export async function postponeReminder(ownerId: string, id: string, dueAt: string) {
  const [reminder] = await getDb()
    .update(reminders)
    .set({
      dueAt,
      status: "pending",
      notifiedAt: null,
      callStatus: null,
      callAttempts: 0,
      calledAt: null,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.id, id),
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "time"),
      ),
    )
    .returning(publicReminder);
  return (reminder ?? null) as Reminder | null;
}

export async function updateReminderLocationStatus(
  ownerId: string,
  id: string,
  locationStatus: ReminderLocationStatus,
) {
  const [reminder] = await getDb()
    .update(reminders)
    .set({ locationStatus, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.id, id),
        eq(reminders.triggerType, "location"),
      ),
    )
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

const MAX_REMINDER_CALL_ATTEMPTS = 3;
const REMINDER_CALL_WINDOW_MS = 30 * 60_000;

function dueCallReminderFilter(ownerId: string, now: Date) {
  return and(
    eq(reminders.ownerId, ownerId),
    eq(reminders.delivery, "call"),
    eq(reminders.status, "pending"),
    lte(reminders.dueAt, now.toISOString()),
    or(
      isNull(reminders.callStatus),
      and(
        eq(reminders.callStatus, "failed"),
        lt(reminders.callAttempts, MAX_REMINDER_CALL_ATTEMPTS),
      ),
    ),
  );
}

// Marks due phone-call reminders so exactly one scheduler run places each call.
export async function claimDueCallReminders(ownerId: string, now = new Date()) {
  const stamp = now.toISOString();
  const oldestCallable = new Date(now.getTime() - REMINDER_CALL_WINDOW_MS).toISOString();
  const db = getDb();
  await db
    .update(reminders)
    .set({ callStatus: "missed", updatedAt: stamp })
    .where(and(dueCallReminderFilter(ownerId, now), lt(reminders.dueAt, oldestCallable)));
  return db
    .update(reminders)
    .set({
      callStatus: "calling",
      callAttempts: sql`${reminders.callAttempts} + 1`,
      updatedAt: stamp,
    })
    .where(and(dueCallReminderFilter(ownerId, now), gte(reminders.dueAt, oldestCallable)))
    .returning(publicReminder) as Promise<Reminder[]>;
}

export async function markDueCallRemindersUnavailable(ownerId: string, now = new Date()) {
  const stamp = now.toISOString();
  return getDb()
    .update(reminders)
    .set({ callStatus: "unavailable", updatedAt: stamp })
    .where(dueCallReminderFilter(ownerId, now))
    .returning({ id: reminders.id });
}

export async function recordReminderCall(id: string, placed: boolean) {
  const stamp = new Date().toISOString();
  await getDb()
    .update(reminders)
    .set({
      callStatus: placed ? "called" : "failed",
      calledAt: placed ? stamp : undefined,
      updatedAt: stamp,
    })
    .where(and(eq(reminders.id, id), eq(reminders.callStatus, "calling")));
}
