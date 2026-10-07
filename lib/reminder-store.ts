import { and, asc, eq, gt, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { reminders, userProfiles } from "@/db/schema";
import { isValidTimeZone } from "@/lib/profile-schedule";
import {
  LOCATION_REMINDER_DUE_AT,
  type Reminder,
  type ReminderDelivery,
  type ReminderLocationStatus,
  type ReminderPlaceEvent,
  type ReminderStatus,
} from "@/lib/reminder";
import {
  claimRepeatingAlert,
  completeRepeatingOccurrence,
  MAX_REMINDER_CALL_ATTEMPTS,
  nextOccurrence,
  parseReminderRepeat,
  REMINDER_CALL_WINDOW_MS,
  restoreRepeatingOccurrence,
  rollRepeatingReminder,
  serializeReminderRepeat,
  type ReminderRepeat,
  type RepeatingReminderChange,
} from "@/lib/reminder-repeat";
import { USER_TIME_ZONE } from "@/lib/time-context";

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
  repeatRule: reminders.repeatRule,
  lastOccurrenceAt: reminders.lastOccurrenceAt,
  createdAt: reminders.createdAt,
  updatedAt: reminders.updatedAt,
};

type ReminderRow = Omit<Reminder, "repeat"> & { repeatRule: string | null };

// The stored rule is checked every time it is read: a rule that no longer
// validates makes the reminder an ordinary one-time reminder.
function toReminder<Row extends { repeatRule: string | null }>(row: Row) {
  const { repeatRule, ...rest } = row;
  return { ...rest, repeat: parseReminderRepeat(repeatRule) };
}

function toReminders(rows: unknown) {
  return (rows as ReminderRow[]).map((row) => toReminder(row) as Reminder);
}

function firstReminder(rows: unknown) {
  return toReminders(rows)[0] ?? null;
}

/**
 * The time zone a new repeating reminder is worked out in: the one the user's
 * own device last reported (user_profiles.time_zone), else the app default.
 */
export async function reminderTimeZone(ownerId: string) {
  try {
    const [row] = await getDb()
      .select({ timeZone: userProfiles.timeZone })
      .from(userProfiles)
      .where(eq(userProfiles.ownerId, ownerId))
      .limit(1);
    if (isValidTimeZone(row?.timeZone)) return row.timeZone;
  } catch (error) {
    console.error("Reminder time zone lookup failed", error);
  }
  return USER_TIME_ZONE;
}

// Pending reminders stay listed, overdue or not, until the user completes or
// postpones them. Completed and dismissed reminders drop out once their time
// has passed.
export async function listReminders(
  ownerId: string,
  limit = 200,
): Promise<Reminder[]> {
  return toReminders(
    await getDb()
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
      .limit(limit),
  );
}

export async function createReminder(
  ownerId: string,
  input: {
    title: string;
    notes?: string | null;
    dueAt?: string;
    delivery?: ReminderDelivery;
    location?: { place: string; event: ReminderPlaceEvent };
    // Time reminders only. dueAt must be the rule's first occurrence.
    repeat?: ReminderRepeat | null;
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
      // A location reminder can call too: the iPhone reports the arrival or departure.
      delivery: input.delivery ?? "app",
      triggerType: input.location ? "location" : "time",
      place: input.location?.place ?? null,
      placeEvent: input.location?.event ?? null,
      repeatRule: input.location ? null : serializeReminderRepeat(input.repeat ?? null),
      createdAt: now,
      updatedAt: now,
    })
    .returning(publicReminder);
  return toReminder(reminder) as Reminder;
}

type RepeatingRow = ReminderRow & { callAttempts: number };

const repeatingRow = { ...publicReminder, callAttempts: reminders.callAttempts };

function sameOrNull(
  column: typeof reminders.notifiedAt | typeof reminders.lastOccurrenceAt,
  value: string | null,
) {
  return value === null ? isNull(column) : eq(column, value);
}

// Applies a change worked out from `row` only if the reminder is still exactly
// as it was read, so two apps (or an app and the scheduler) acting on the same
// occurrence can never both win.
async function applyRepeatingChange(row: RepeatingRow, change: RepeatingReminderChange, now: Date) {
  const [updated] = await getDb()
    .update(reminders)
    .set({
      ...(change.dueAt !== undefined ? { dueAt: change.dueAt } : {}),
      ...(change.notifiedAt !== undefined ? { notifiedAt: change.notifiedAt } : {}),
      ...(change.lastOccurrenceAt !== undefined ? { lastOccurrenceAt: change.lastOccurrenceAt } : {}),
      ...(change.resetCall ? { callStatus: null, callAttempts: 0 } : {}),
      ...(change.finish ? { status: "completed" } : {}),
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        eq(reminders.id, row.id),
        eq(reminders.status, "pending"),
        eq(reminders.dueAt, row.dueAt),
        sameOrNull(reminders.notifiedAt, row.notifiedAt),
        sameOrNull(reminders.lastOccurrenceAt, row.lastOccurrenceAt),
      ),
    )
    .returning(publicReminder);
  return updated ? (toReminder(updated) as Reminder) : null;
}

async function loadRepeatingRow(ownerId: string, id: string) {
  const [row] = await getDb()
    .select(repeatingRow)
    .from(reminders)
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.id, id),
        eq(reminders.triggerType, "time"),
        isNotNull(reminders.repeatRule),
      ),
    )
    .limit(1);
  const rule = row ? parseReminderRepeat(row.repeatRule) : null;
  return row && rule ? { row: row as RepeatingRow, rule } : null;
}

export type ReminderOccurrenceResult =
  | { kind: "not_repeating" }
  // Changed by something else twice in a row; nothing was done.
  | { kind: "busy" }
  | { kind: "unchanged"; reminder: Reminder }
  | { kind: "updated"; reminder: Reminder };

/**
 * "Done" on a repeating reminder: finishes one occurrence and keeps the
 * series. Returns not_repeating for a one-time reminder (or a finished one),
 * which the caller completes the ordinary way.
 */
export async function completeReminderOccurrence(
  ownerId: string,
  id: string,
  occurrence: string | null,
  now = new Date(),
): Promise<ReminderOccurrenceResult> {
  // Retried once: another app may have moved the reminder on in between.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const found = await loadRepeatingRow(ownerId, id);
    if (!found || found.row.status !== "pending") return { kind: "not_repeating" };
    const change = completeRepeatingOccurrence(found.rule, found.row, occurrence, now);
    if (!change) {
      const unchanged = await getDb()
        .select(publicReminder)
        .from(reminders)
        .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, id)))
        .limit(1);
      const reminder = firstReminder(unchanged);
      return reminder ? { kind: "unchanged", reminder } : { kind: "not_repeating" };
    }
    const reminder = await applyRepeatingChange(found.row, change, now);
    if (reminder) return { kind: "updated", reminder };
  }
  return { kind: "busy" };
}

/** Undo for a skipped occurrence: puts the reminder back on it. */
export async function restoreReminderOccurrence(
  ownerId: string,
  id: string,
  occurrence: string,
  now = new Date(),
) {
  const found = await loadRepeatingRow(ownerId, id);
  if (!found || found.row.status !== "pending") return null;
  const change = restoreRepeatingOccurrence(found.row, occurrence, now);
  return change ? applyRepeatingChange(found.row, change, now) : null;
}

/**
 * Sets, changes, or clears how an open time reminder repeats. The due time
 * moves to the rule's next occurrence when it doesn't already fall on one.
 */
export async function updateReminderRepeat(
  ownerId: string,
  id: string,
  build: (current: { dueAt: string; repeat: ReminderRepeat | null }) => ReminderRepeat | null,
  now = new Date(),
) {
  const [row] = await getDb()
    .select(publicReminder)
    .from(reminders)
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.id, id),
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "time"),
      ),
    )
    .limit(1);
  if (!row) return null;
  const current = parseReminderRepeat(row.repeatRule);
  const rule = build({ dueAt: row.dueAt, repeat: current });
  const stamp = now.toISOString();
  if (!rule) {
    const [updated] = await getDb()
      .update(reminders)
      .set({ repeatRule: null, lastOccurrenceAt: null, updatedAt: stamp })
      .where(and(eq(reminders.id, row.id), eq(reminders.dueAt, row.dueAt)))
      .returning(publicReminder);
    return firstReminder(updated ? [updated] : []);
  }
  // Keep a due time the new rule also lands on; otherwise take its next one.
  const dueMs = Date.parse(row.dueAt);
  const dueAt = nextOccurrence(rule, Math.max(dueMs - 1, now.getTime()));
  if (!dueAt) return null;
  const moved = dueAt !== row.dueAt;
  const [updated] = await getDb()
    .update(reminders)
    .set({
      repeatRule: serializeReminderRepeat(rule),
      dueAt,
      ...(moved ? { notifiedAt: null, callStatus: null, callAttempts: 0, lastOccurrenceAt: null } : {}),
      updatedAt: stamp,
    })
    .where(and(eq(reminders.id, row.id), eq(reminders.dueAt, row.dueAt)))
    .returning(publicReminder);
  return firstReminder(updated ? [updated] : []);
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
  return firstReminder(reminder ? [reminder] : []);
}

export async function updateReminderDelivery(
  ownerId: string,
  id: string,
  delivery: ReminderDelivery,
) {
  const now = new Date().toISOString();
  // Only a pending reminder that hasn't fired yet can change how it will be
  // delivered: a time reminder still in the future, or any open place reminder.
  const [reminder] = await getDb()
    .update(reminders)
    .set({ delivery, callStatus: null, callAttempts: 0, calledAt: null, updatedAt: now })
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.id, id),
        eq(reminders.status, "pending"),
        or(
          and(eq(reminders.triggerType, "time"), gt(reminders.dueAt, now)),
          eq(reminders.triggerType, "location"),
        ),
      ),
    )
    .returning(publicReminder);
  return firstReminder(reminder ? [reminder] : []);
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
      // A snooze takes over from the occurrence that just went off. A repeating
      // reminder goes back to its own times after the snoozed alert.
      lastOccurrenceAt: null,
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
  return firstReminder(reminder ? [reminder] : []);
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
  return firstReminder(reminder ? [reminder] : []);
}

export async function deleteReminder(ownerId: string, id: string) {
  const [deleted] = await getDb()
    .delete(reminders)
    .where(and(eq(reminders.ownerId, ownerId), eq(reminders.id, id)))
    .returning({ id: reminders.id });
  return deleted?.id ?? null;
}

// Reminders an app should alert about now. Each one is handed to exactly one
// caller: a one-time reminder once, a repeating reminder once per occurrence.
export async function claimDueReminders(ownerId: string, now = new Date()) {
  const notifiedAt = now.toISOString();
  const db = getDb();
  const due = toReminders(
    await db
      .update(reminders)
      .set({ notifiedAt, updatedAt: notifiedAt })
      .where(
        and(
          eq(reminders.ownerId, ownerId),
          eq(reminders.status, "pending"),
          isNull(reminders.repeatRule),
          isNull(reminders.notifiedAt),
          lte(reminders.dueAt, notifiedAt),
        ),
      )
      .returning(publicReminder),
  );

  // Repeating: one that is due, or one the scheduler already moved on whose
  // alert is still owed.
  const repeating = (await db
    .select(repeatingRow)
    .from(reminders)
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "time"),
        isNotNull(reminders.repeatRule),
        or(lte(reminders.dueAt, notifiedAt), isNotNull(reminders.lastOccurrenceAt)),
      ),
    )) as RepeatingRow[];
  for (const row of repeating) {
    const rule = parseReminderRepeat(row.repeatRule);
    if (!rule) {
      // A rule that no longer validates: alert once, like a one-time reminder.
      if (row.notifiedAt === null && Date.parse(row.dueAt) <= now.getTime()) {
        const claimed = await applyRepeatingChange(row, { notifiedAt }, now);
        if (claimed) due.push(claimed);
      }
      continue;
    }
    const { alert, change } = claimRepeatingAlert(rule, row, now);
    if (!change) continue;
    const updated = await applyRepeatingChange(row, change, now);
    if (updated && alert) due.push(updated);
  }
  return due;
}

/**
 * Run by the every-minute scheduler: moves every due repeating reminder on to
 * its next future occurrence, so the series continues with no app open. It
 * never alerts; a reminder still waiting on its phone call is left alone.
 */
export async function rollDueRepeatingReminders(now = new Date()) {
  const rows = (await getDb()
    .select(repeatingRow)
    .from(reminders)
    .where(
      and(
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "time"),
        isNotNull(reminders.repeatRule),
        lte(reminders.dueAt, now.toISOString()),
      ),
    )
    .limit(500)) as RepeatingRow[];
  let rolled = 0;
  for (const row of rows) {
    const rule = parseReminderRepeat(row.repeatRule);
    const change = rule ? rollRepeatingReminder(rule, row, now) : null;
    if (change && (await applyRepeatingChange(row, change, now))) rolled += 1;
  }
  return rolled;
}

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
    .returning(publicReminder)
    .then(toReminders);
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

// Pending place reminders set to call, for the iPhone to watch on its own.
export async function listLocationCallReminders(ownerId: string) {
  return getDb()
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.ownerId, ownerId),
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "location"),
        eq(reminders.delivery, "call"),
      ),
    );
}

// Claims a place reminder's call when the iPhone reports the arrival or
// departure. Each reminder is called at most once per arming, with retries
// only after a failed attempt.
export async function claimLocationReminderCall(id: string, now = new Date()) {
  const stamp = now.toISOString();
  const [reminder] = await getDb()
    .update(reminders)
    .set({
      callStatus: "calling",
      callAttempts: sql`${reminders.callAttempts} + 1`,
      updatedAt: stamp,
    })
    .where(
      and(
        eq(reminders.id, id),
        eq(reminders.status, "pending"),
        eq(reminders.triggerType, "location"),
        eq(reminders.delivery, "call"),
        or(
          isNull(reminders.callStatus),
          and(
            eq(reminders.callStatus, "failed"),
            lt(reminders.callAttempts, MAX_REMINDER_CALL_ATTEMPTS),
          ),
        ),
      ),
    )
    .returning({ ...publicReminder, ownerId: reminders.ownerId });
  return reminder ? toReminder(reminder) : null;
}

export async function markLocationReminderCallUnavailable(id: string) {
  const stamp = new Date().toISOString();
  await getDb()
    .update(reminders)
    .set({ callStatus: "unavailable", updatedAt: stamp })
    .where(and(eq(reminders.id, id), eq(reminders.callStatus, "calling")));
}
