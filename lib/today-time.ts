// Clock and calendar-date helpers for the Today briefing. Everything "today",
// "tomorrow", or "overdue" is worked out in the user's own time zone, which
// the page sends as ?tz=. No I/O here.

export const DEFAULT_TIME_ZONE = "UTC";

/** The IANA zone if this runtime knows it, otherwise UTC. */
export function validTimeZone(value: string | null | undefined) {
  const zone = (value ?? "").trim();
  if (!zone || zone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-/]*$/u.test(zone)) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export type LocalClock = {
  /** "2026-10-07" */
  date: string;
  hour: number;
  minute: number;
  /** "14:05" */
  time: string;
  /** "Wednesday" */
  weekday: string;
};

/** The wall clock in a time zone at an instant. */
export function localClock(at: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "long",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  const hour = Number(part("hour")) % 24;
  const minute = Number(part("minute"));
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour,
    minute,
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    weekday: part("weekday"),
  };
}

/** A real calendar date written "YYYY-MM-DD". */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function dayNumber(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

/** Whole days from one calendar date to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string) {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: string, days: number) {
  return new Date((dayNumber(date) + days) * 86_400_000).toISOString().slice(0, 10);
}

/** "Monday" for a calendar date. */
export function weekdayOf(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(new Date(`${date}T00:00:00Z`));
}

/** "Sep 28" for a calendar date. */
export function monthDay(date: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}
