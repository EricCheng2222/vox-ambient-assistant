// Repeating reminders: the stored rule, when it next comes due, what happens
// when an occurrence goes off or is marked done, and how it is described.
// Everything here is pure (no I/O), so the server, the page, and the tests
// share one definition.

export type ReminderRepeatFrequency = "daily" | "weekly" | "monthly" | "yearly";

/**
 * How a reminder repeats. Stored as JSON in reminders.repeat_rule.
 *
 * The time is a wall-clock time in `zone`, so "every day at 08:00" stays at
 * 08:00 across daylight-saving changes. A monthly or yearly day that a month
 * doesn't have (the 31st, Feb 29) falls on that month's last day.
 */
export type ReminderRepeat = {
  freq: ReminderRepeatFrequency;
  /** "HH:MM", 24-hour, on the clock of `zone`. */
  time: string;
  /** IANA time zone the rule is worked out in. */
  zone: string;
  /** Weekly only: 0 (Sunday) to 6 (Saturday), ascending, at least one. */
  days?: number[];
  /** Monthly and yearly: 1 to 31. */
  monthDay?: number;
  /** Yearly only: 1 to 12. */
  month?: number;
  /** Last calendar date (in `zone`) it may come due, "YYYY-MM-DD". */
  until?: string;
};

export type ReminderRepeatPreset = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";

export const reminderRepeatPresets: Array<{ id: ReminderRepeatPreset; label: string }> = [
  { id: "none", label: "Doesn’t repeat" },
  { id: "daily", label: "Every day" },
  { id: "weekdays", label: "Every weekday" },
  { id: "weekly", label: "Every week" },
  { id: "monthly", label: "Every month" },
  { id: "yearly", label: "Every year" },
];

export function isReminderRepeatPreset(value: unknown): value is ReminderRepeatPreset {
  return reminderRepeatPresets.some((preset) => preset.id === value);
}

const WEEKDAYS = [1, 2, 3, 4, 5];

function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/u.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isClockTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value);
}

/** A real calendar date written "YYYY-MM-DD". */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function isWholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The rule in its one stored shape, or null when it isn't a valid rule.
 * Accepts an object or the JSON text kept in the database. Unknown fields are
 * dropped; a wrong field makes the whole rule invalid rather than guessed at.
 */
export function parseReminderRepeat(value: unknown): ReminderRepeat | null {
  let raw = value;
  if (typeof raw === "string") {
    if (!raw || raw.length > 400) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (!isClockTime(input.time) || !isTimeZone(input.zone)) return null;
  const rule: ReminderRepeat = { freq: "daily", time: input.time, zone: input.zone };

  if (input.freq === "daily") {
    if (input.days !== undefined || input.monthDay !== undefined || input.month !== undefined) return null;
  } else if (input.freq === "weekly") {
    if (input.monthDay !== undefined || input.month !== undefined) return null;
    if (!Array.isArray(input.days) || input.days.length < 1 || input.days.length > 7) return null;
    if (!input.days.every((day) => isWholeNumber(day, 0, 6))) return null;
    const days = [...new Set(input.days as number[])].sort((left, right) => left - right);
    if (days.length !== input.days.length) return null;
    // Every day of the week is simply daily.
    if (days.length < 7) {
      rule.freq = "weekly";
      rule.days = days;
    }
  } else if (input.freq === "monthly") {
    if (input.days !== undefined || input.month !== undefined) return null;
    if (!isWholeNumber(input.monthDay, 1, 31)) return null;
    rule.freq = "monthly";
    rule.monthDay = input.monthDay;
  } else if (input.freq === "yearly") {
    if (input.days !== undefined) return null;
    if (!isWholeNumber(input.month, 1, 12) || !isWholeNumber(input.monthDay, 1, 31)) return null;
    // 2024 is a leap year, so Feb 29 is allowed and Feb 30 is not.
    if (input.monthDay > daysInMonth(2024, input.month)) return null;
    rule.freq = "yearly";
    rule.month = input.month;
    rule.monthDay = input.monthDay;
  } else {
    return null;
  }

  if (input.until !== undefined && input.until !== null) {
    if (!isCalendarDate(input.until)) return null;
    rule.until = input.until;
  }
  return rule;
}

export function serializeReminderRepeat(rule: ReminderRepeat | null) {
  const clean = rule ? parseReminderRepeat(rule) : null;
  return clean ? JSON.stringify(clean) : null;
}

// ---------------------------------------------------------------------------
// Time-zone arithmetic
// ---------------------------------------------------------------------------

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function localParts(at: number, zone: string): LocalParts {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, formatter);
  }
  const read: Record<string, number> = {};
  for (const part of formatter.formatToParts(new Date(at))) {
    if (part.type !== "literal") read[part.type] = Number(part.value);
  }
  return {
    year: read.year,
    month: read.month,
    day: read.day,
    hour: read.hour % 24,
    minute: read.minute,
    second: read.second,
  };
}

function zoneOffset(at: number, zone: string) {
  const local = localParts(at, zone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asUtc - Math.floor(at / 1000) * 1000;
}

/**
 * The instant a wall-clock time happens in a zone. A time skipped by a
 * daylight-saving jump (02:30 on a spring-forward night) lands just after the
 * jump (03:30); a time that happens twice uses the first.
 */
export function zonedTimeToUtc(date: string, time: string, zone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offsets = new Set(
    [wall - 86_400_000, wall, wall + 86_400_000].map((probe) => zoneOffset(probe, zone)),
  );
  const candidates = [...offsets].map((offset) => wall - offset);
  const exact = candidates.filter((candidate) => candidate + zoneOffset(candidate, zone) === wall);
  return exact.length ? Math.min(...exact) : Math.max(...candidates);
}

function localDate(at: number, zone: string) {
  const local = localParts(at, zone);
  return { year: local.year, month: local.month, day: local.day };
}

function dateText(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function weekdayOf(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Calendar dates the rule falls on, in order, starting no earlier than `from`'s month or day. */
function* candidateDates(rule: ReminderRepeat, from: { year: number; month: number; day: number }) {
  if (rule.freq === "daily" || rule.freq === "weekly") {
    let date = dateText(from.year, from.month, from.day);
    // 370 days comfortably covers a week of candidates plus any clock oddity.
    for (let step = 0; step < 370; step += 1, date = addDays(date, 1)) {
      if (rule.freq === "daily" || rule.days?.includes(weekdayOf(date))) yield date;
    }
    return;
  }
  if (rule.freq === "monthly") {
    let { year, month } = from;
    for (let step = 0; step < 24; step += 1) {
      yield dateText(year, month, Math.min(rule.monthDay ?? 1, daysInMonth(year, month)));
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
    return;
  }
  const month = rule.month ?? 1;
  for (let year = from.year; year < from.year + 12; year += 1) {
    yield dateText(year, month, Math.min(rule.monthDay ?? 1, daysInMonth(year, month)));
  }
}

/**
 * The first time the rule comes due strictly after `after`, as an ISO
 * timestamp, or null once the rule has ended.
 */
export function nextOccurrence(rule: ReminderRepeat, after: Date | number | string): string | null {
  const afterMs = after instanceof Date ? after.getTime() : typeof after === "string" ? Date.parse(after) : after;
  if (!Number.isFinite(afterMs)) return null;
  for (const date of candidateDates(rule, localDate(afterMs, rule.zone))) {
    if (rule.until && date > rule.until) return null;
    const at = zonedTimeToUtc(date, rule.time, rule.zone);
    if (at > afterMs) return new Date(at).toISOString();
  }
  return null;
}

/** The next few times the rule comes due after `after`. */
export function upcomingOccurrences(rule: ReminderRepeat, after: Date | number | string, count: number) {
  const occurrences: string[] = [];
  let cursor: Date | number | string = after;
  while (occurrences.length < count) {
    const next = nextOccurrence(rule, cursor);
    if (!next) break;
    occurrences.push(next);
    cursor = next;
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// Building a rule
// ---------------------------------------------------------------------------

const WEEKDAY_CODES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/** The JSON-schema fragment the reminder parsers ask the model to fill in. */
export const reminderRepeatExtractionSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["none", "daily", "weekdays", "weekly", "monthly", "yearly", "unsupported"],
    },
    weekdays: { type: "array", items: { type: "string", enum: [...WEEKDAY_CODES] } },
    month_day: { type: ["integer", "null"] },
    month: { type: ["integer", "null"] },
    time: { type: ["string", "null"] },
    start_date: { type: ["string", "null"] },
    until: { type: ["string", "null"] },
  },
  required: ["kind", "weekdays", "month_day", "month", "time", "start_date", "until"],
  additionalProperties: false,
} as const;

/** Prompt text that goes with reminderRepeatExtractionSchema. */
export const REMINDER_REPEAT_EXTRACTION_GUIDE =
  "Repeating: fill in `repeat`. Use kind 'none' for a one-time reminder. Use a repeating kind only when the user clearly asks for it to repeat (every day, daily, each morning, every weekday, every Monday and Thursday, on the 1st of every month, every year on March 7, 每天, 每日, 天天, 平日, 每週一三五, 每個禮拜二, 每月一號, 每年三月七日): 'daily' for every day; 'weekdays' for Monday to Friday (weekdays, workdays, 平日, 上班日); 'weekly' with weekdays listing every named day as mon, tue, wed, thu, fri, sat, sun (每週一三五 is mon, wed, fri; weekends is sat, sun); 'monthly' with month_day 1 to 31 (use 31 for the last day of the month); 'yearly' with month 1 to 12 and month_day. Set time to the time of day as 24-hour HH:MM (09:00 when the user gives none). Set start_date (YYYY-MM-DD) only when the user says when it should begin, otherwise null. Set until (YYYY-MM-DD, the last day it may happen) only when the user gives an end, otherwise null. For kinds that do not use them, weekdays is [] and month_day and month are null. Use kind 'unsupported' for a repeat this cannot express exactly (every other week, every 3 days, every 2 hours, twice a day, the first Monday of the month, several different times); never approximate one. A word like 'every' inside what to be reminded about (remind me to water every plant at 6pm) is not a repeat.";

export type ReminderRepeatExtraction =
  | { kind: "none" }
  | { kind: "rule"; rule: ReminderRepeat; startDate: string | null }
  | { kind: "invalid"; reason: string };

export const REPEAT_UNSUPPORTED_MESSAGE =
  "Vox can repeat a reminder every day, on weekdays, on chosen days of the week, every month, or every year. Please say which you want, or ask for a one-time reminder.";

/**
 * Checks what the model said about repeating and turns it into a rule.
 * Anything missing or out of range is refused, never guessed: the caller then
 * asks the user instead of saving the wrong reminder.
 */
export function repeatFromExtraction(value: unknown, zone: string): ReminderRepeatExtraction {
  if (value === null || value === undefined) return { kind: "none" };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { kind: "invalid", reason: REPEAT_UNSUPPORTED_MESSAGE };
  }
  const input = value as Record<string, unknown>;
  if (input.kind === "none") return { kind: "none" };
  if (input.kind === "unsupported") return { kind: "invalid", reason: REPEAT_UNSUPPORTED_MESSAGE };

  const time = input.time === null || input.time === undefined ? "09:00" : input.time;
  if (!isClockTime(time)) {
    return { kind: "invalid", reason: "Please say what time the repeating reminder should go off." };
  }
  let rule: ReminderRepeat | null = null;
  if (input.kind === "daily") {
    rule = parseReminderRepeat({ freq: "daily", time, zone });
  } else if (input.kind === "weekdays") {
    rule = parseReminderRepeat({ freq: "weekly", days: WEEKDAYS, time, zone });
  } else if (input.kind === "weekly") {
    const names = Array.isArray(input.weekdays) ? input.weekdays : [];
    const days = names.map((name) => WEEKDAY_CODES.indexOf(name as (typeof WEEKDAY_CODES)[number]));
    if (!days.length || days.includes(-1)) {
      return { kind: "invalid", reason: "Please say which days of the week the reminder should repeat on." };
    }
    rule = parseReminderRepeat({ freq: "weekly", days: [...new Set(days)], time, zone });
  } else if (input.kind === "monthly") {
    if (!isWholeNumber(input.month_day, 1, 31)) {
      return { kind: "invalid", reason: "Please say which day of the month the reminder should repeat on." };
    }
    rule = parseReminderRepeat({ freq: "monthly", monthDay: input.month_day, time, zone });
  } else if (input.kind === "yearly") {
    rule = parseReminderRepeat({ freq: "yearly", month: input.month, monthDay: input.month_day, time, zone });
    if (!rule) {
      return { kind: "invalid", reason: "Please say which date the reminder should repeat on each year." };
    }
  }
  if (!rule) return { kind: "invalid", reason: REPEAT_UNSUPPORTED_MESSAGE };

  if (input.until !== null && input.until !== undefined) {
    if (!isCalendarDate(input.until)) {
      return { kind: "invalid", reason: "Please say the date the repeating reminder should end." };
    }
    rule.until = input.until;
  }
  let startDate: string | null = null;
  if (input.start_date !== null && input.start_date !== undefined) {
    if (!isCalendarDate(input.start_date)) {
      return { kind: "invalid", reason: "Please say the date the repeating reminder should start." };
    }
    startDate = input.start_date;
  }
  return { kind: "rule", rule, startDate };
}

/** The first time a new rule comes due: after now, and not before its start date. */
export function firstOccurrence(rule: ReminderRepeat, startDate: string | null, now: Date | number = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const startMs = startDate ? zonedTimeToUtc(startDate, "00:00", rule.zone) - 1 : nowMs;
  return nextOccurrence(rule, Math.max(nowMs, startMs));
}

/**
 * A rule for one of the menu choices, taking the time of day, weekday, and
 * date from the reminder's current due time. An end date already set is kept.
 */
export function repeatFromPreset(
  preset: ReminderRepeatPreset,
  dueAt: string,
  zone: string,
  existing: ReminderRepeat | null = null,
): ReminderRepeat | null {
  if (preset === "none") return null;
  const dueMs = Date.parse(dueAt);
  const ruleZone = existing?.zone ?? zone;
  if (!Number.isFinite(dueMs) || !isTimeZone(ruleZone)) return null;
  const local = localParts(dueMs, ruleZone);
  // An existing rule's own time wins: the due time may be a snooze.
  const time = existing?.time ?? `${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  const base = { time, zone: ruleZone, ...(existing?.until ? { until: existing.until } : {}) };
  const date = dateText(local.year, local.month, local.day);
  if (preset === "daily") return parseReminderRepeat({ ...base, freq: "daily" });
  if (preset === "weekdays") return parseReminderRepeat({ ...base, freq: "weekly", days: WEEKDAYS });
  if (preset === "weekly") {
    return parseReminderRepeat({
      ...base,
      freq: "weekly",
      days: existing?.freq === "weekly" && !isWeekdays(existing) ? existing.days : [weekdayOf(date)],
    });
  }
  if (preset === "monthly") {
    return parseReminderRepeat({ ...base, freq: "monthly", monthDay: existing?.monthDay ?? local.day });
  }
  return parseReminderRepeat({
    ...base,
    freq: "yearly",
    month: existing?.month ?? local.month,
    monthDay: existing?.monthDay ?? local.day,
  });
}

function isWeekdays(rule: ReminderRepeat) {
  return rule.freq === "weekly" && rule.days?.join() === WEEKDAYS.join();
}

/** Which menu choice a rule corresponds to. */
export function presetOfRepeat(rule: ReminderRepeat | null): ReminderRepeatPreset {
  if (!rule) return "none";
  if (isWeekdays(rule)) return "weekdays";
  return rule.freq;
}

// ---------------------------------------------------------------------------
// What happens when an occurrence comes due or is marked done
// ---------------------------------------------------------------------------

/** How long after its due time a phone call is still worth placing. */
export const REMINDER_CALL_WINDOW_MS = 30 * 60_000;
export const MAX_REMINDER_CALL_ATTEMPTS = 3;

export type RepeatingReminderState = {
  dueAt: string;
  /** When the app last alerted about this reminder. */
  notifiedAt: string | null;
  /** The occurrence that last went off and hasn't been marked done. */
  lastOccurrenceAt: string | null;
  delivery: "app" | "call";
  callStatus: string | null;
  callAttempts: number;
};

export type RepeatingReminderChange = {
  dueAt?: string;
  notifiedAt?: string | null;
  lastOccurrenceAt?: string | null;
  /** Clears the call bookkeeping so the next occurrence can be phoned. */
  resetCall?: boolean;
  /** The series has no further occurrence: finish the reminder. */
  finish?: boolean;
};

function ms(value: string | null) {
  return value ? Date.parse(value) : Number.NaN;
}

/** A phone call for the current occurrence is still to be placed (or retried). */
function callStillOwed(state: RepeatingReminderState, now: number) {
  if (state.delivery !== "call" || now - ms(state.dueAt) > REMINDER_CALL_WINDOW_MS) return false;
  if (state.callStatus === null || state.callStatus === "calling") return true;
  return state.callStatus === "failed" && state.callAttempts < MAX_REMINDER_CALL_ATTEMPTS;
}

/** The next due time once the current one is over: always in the future, so a backlog never bursts. */
export function dueAfter(rule: ReminderRepeat, dueAt: string, now: number) {
  return nextOccurrence(rule, Math.max(ms(dueAt), now));
}

function alertOwedFor(state: RepeatingReminderState, occurrence: string) {
  return state.notifiedAt === null || ms(state.notifiedAt) < ms(occurrence);
}

/**
 * An app (web, Mac, iPhone page) asks which reminders to alert about.
 * Returns whether to alert, and the change that records it. An occurrence
 * alerts once; the reminder then moves to its next future occurrence, unless a
 * phone call for this one is still to come (the caller moves it afterwards).
 */
export function claimRepeatingAlert(
  rule: ReminderRepeat,
  state: RepeatingReminderState,
  now: Date | number = Date.now(),
): { alert: boolean; change: RepeatingReminderChange | null } {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const stamp = new Date(nowMs).toISOString();
  if (ms(state.dueAt) <= nowMs) {
    const alert = alertOwedFor(state, state.dueAt);
    const next = callStillOwed(state, nowMs) ? null : dueAfter(rule, state.dueAt, nowMs);
    if (next) {
      return {
        alert,
        change: {
          dueAt: next,
          lastOccurrenceAt: state.dueAt,
          resetCall: true,
          ...(alert ? { notifiedAt: stamp } : {}),
        },
      };
    }
    // The last occurrence of the series, or one still waiting on its call.
    return { alert, change: alert ? { notifiedAt: stamp } : null };
  }
  // Already moved on by the scheduler before any app could alert.
  if (state.lastOccurrenceAt && alertOwedFor(state, state.lastOccurrenceAt)) {
    return { alert: true, change: { notifiedAt: stamp } };
  }
  return { alert: false, change: null };
}

/**
 * The every-minute scheduler moves a due repeating reminder on to its next
 * future occurrence without alerting. The app alert for the occurrence that
 * just passed stays owed (see claimRepeatingAlert).
 */
export function rollRepeatingReminder(
  rule: ReminderRepeat,
  state: RepeatingReminderState,
  now: Date | number = Date.now(),
): RepeatingReminderChange | null {
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (ms(state.dueAt) > nowMs || callStillOwed(state, nowMs)) return null;
  const next = dueAfter(rule, state.dueAt, nowMs);
  return next ? { dueAt: next, lastOccurrenceAt: state.dueAt, resetCall: true } : null;
}

/**
 * Which occurrence "Done" means when nothing names one: the one that is due
 * now, else the one that last went off, else the upcoming one (a skip).
 */
export function occurrenceToComplete(
  state: Pick<RepeatingReminderState, "dueAt" | "lastOccurrenceAt">,
  now: Date | number = Date.now(),
) {
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (ms(state.dueAt) <= nowMs) return state.dueAt;
  return state.lastOccurrenceAt ?? state.dueAt;
}

/**
 * "Done" on a repeating reminder finishes one occurrence, never the series.
 * `occurrence` says which one (the page and the iPhone's notification name
 * it); see occurrenceToComplete for the default.
 */
export function completeRepeatingOccurrence(
  rule: ReminderRepeat,
  state: RepeatingReminderState,
  occurrence: string | null,
  now: Date | number = Date.now(),
): RepeatingReminderChange | null {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const stamp = new Date(nowMs).toISOString();
  const target = ms(occurrence ?? occurrenceToComplete(state, nowMs));
  if (state.lastOccurrenceAt && target === ms(state.lastOccurrenceAt)) {
    // It already went off and the reminder has moved on: just tick it off.
    return { lastOccurrenceAt: null, notifiedAt: stamp };
  }
  if (target !== ms(state.dueAt)) return null;
  const next = dueAfter(rule, state.dueAt, nowMs);
  if (!next) return { finish: true, lastOccurrenceAt: null };
  return {
    dueAt: next,
    lastOccurrenceAt: null,
    resetCall: true,
    // Done after it came due: nothing more to alert about for it.
    ...(ms(state.dueAt) <= nowMs ? { notifiedAt: stamp } : {}),
  };
}

/**
 * Undo for skipping an upcoming occurrence: puts the reminder back on
 * `occurrence` when that is still in the future and before the current due
 * time.
 */
export function restoreRepeatingOccurrence(
  state: RepeatingReminderState,
  occurrence: string,
  now: Date | number = Date.now(),
): RepeatingReminderChange | null {
  const nowMs = now instanceof Date ? now.getTime() : now;
  const target = ms(occurrence);
  if (!Number.isFinite(target) || target <= nowMs || target >= ms(state.dueAt)) return null;
  return { dueAt: new Date(target).toISOString(), resetCall: true };
}

// ---------------------------------------------------------------------------
// iPhone notifications
// ---------------------------------------------------------------------------

// The iPhone schedules each upcoming occurrence as its own local notification,
// so a repeating reminder keeps alerting while Vox stays closed. Each one
// carries the reminder id plus its due time, so "Mark as done" on it finishes
// that occurrence only.
const OCCURRENCE_ID = /^([A-Za-z0-9-]{8,48})-occ-([0-9a-z]{6,10})$/u;

export function occurrenceId(reminderId: string, dueAt: string) {
  return `${reminderId}-occ-${Date.parse(dueAt).toString(36)}`;
}

export function parseOccurrenceId(value: string): { id: string; occurrence: string | null } {
  const match = OCCURRENCE_ID.exec(value);
  if (!match) return { id: value, occurrence: null };
  const at = Number.parseInt(match[2], 36);
  if (!Number.isFinite(at) || at <= 0 || at > 8.64e15) return { id: value, occurrence: null };
  return { id: match[1], occurrence: new Date(at).toISOString() };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

export type ReminderRepeatLanguage = "english" | "taiwan_mandarin";
/** "spoken" is said aloud ("at 8:00 AM"); "short" is shown in lists (", 08:00"). */
export type ReminderRepeatStyle = "spoken" | "short";

const EN_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const EN_DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const EN_MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ZH_DAYS = ["日", "一", "二", "三", "四", "五", "六"];

function ordinal(day: number) {
  const tens = day % 100;
  if (tens >= 11 && tens <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

function listEnglish(items: string[]) {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Monday first, Sunday last. */
function weekOrder(days: number[]) {
  return [...days].sort((left, right) => ((left + 6) % 7) - ((right + 6) % 7));
}

function clockLabel(time: string, language: ReminderRepeatLanguage, style: ReminderRepeatStyle) {
  if (style === "short") return time;
  const [hour, minute] = time.split(":").map(Number);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  const minutes = String(minute).padStart(2, "0");
  if (language === "taiwan_mandarin") return `${hour < 12 ? "上午" : "下午"}${hour12}:${minutes}`;
  return `${hour12}:${minutes} ${hour < 12 ? "AM" : "PM"}`;
}

function patternLabel(rule: ReminderRepeat, language: ReminderRepeatLanguage, style: ReminderRepeatStyle) {
  const zh = language === "taiwan_mandarin";
  if (rule.freq === "daily") return zh ? "每天" : "Every day";
  if (rule.freq === "weekly") {
    const days = weekOrder(rule.days ?? []);
    if (isWeekdays(rule)) return zh ? "每個平日" : "Every weekday";
    if (days.join() === "6,0") return zh ? "每個週末" : "Every weekend";
    if (zh) return `每週${days.map((day) => ZH_DAYS[day]).join("、")}`;
    // Lists keep to short day names once there are several.
    const names = days.map((day) => (style === "short" && days.length > 1 ? EN_DAYS_SHORT[day] : EN_DAYS[day]));
    return `Every ${style === "short" ? names.join(", ") : listEnglish(names)}`;
  }
  const day = rule.monthDay ?? 1;
  if (rule.freq === "monthly") {
    if (day === 31) return zh ? "每月最後一天" : "Every month on the last day";
    return zh ? `每月${day}號` : `Every month on the ${ordinal(day)}`;
  }
  const month = rule.month ?? 1;
  if (zh) return `每年${month}月${day}日`;
  return `Every year on ${(style === "short" ? EN_MONTHS_SHORT : EN_MONTHS)[month - 1]} ${day}`;
}

function untilLabel(until: string, language: ReminderRepeatLanguage, style: ReminderRepeatStyle) {
  const [year, month, day] = until.split("-").map(Number);
  if (language === "taiwan_mandarin") return `，到${year}年${month}月${day}日為止`;
  return `, until ${(style === "short" ? EN_MONTHS_SHORT : EN_MONTHS)[month - 1]} ${day}, ${year}`;
}

/**
 * How a reminder repeats, in plain words: "Every weekday at 8:00 AM" when
 * spoken, "Every weekday, 08:00" in a list.
 */
export function reminderRepeatLabel(
  rule: ReminderRepeat,
  language: ReminderRepeatLanguage = "english",
  style: ReminderRepeatStyle = "short",
) {
  const pattern = patternLabel(rule, language, style);
  const clock = clockLabel(rule.time, language, style);
  const joined =
    language === "taiwan_mandarin"
      ? `${pattern}${style === "short" ? " " : ""}${clock}`
      : style === "short" ? `${pattern}, ${clock}` : `${pattern} at ${clock}`;
  return rule.until ? `${joined}${untilLabel(rule.until, language, style)}` : joined;
}
