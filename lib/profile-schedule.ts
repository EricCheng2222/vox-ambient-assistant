// When the nightly profile update may run: inside the owner's sleep window,
// in their own time zone, once per local day.

/** Used only when no time zone has ever been recorded for an account. */
export const DEFAULT_PROFILE_TIME_ZONE = "Asia/Taipei";

/** Local hours [start, end): 03:00 up to, not including, 05:00. */
export const SLEEP_WINDOW = { startHour: 3, endHour: 5 } as const;

export function isValidTimeZone(value: unknown): value is string {
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

export function resolveTimeZone(stored: unknown) {
  return isValidTimeZone(stored) ? stored : DEFAULT_PROFILE_TIME_ZONE;
}

/** The date (YYYY-MM-DD) and hour on the owner's own clock. */
export function localClock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    day: `${read("year")}-${read("month")}-${read("day")}`,
    hour: Number(read("hour")) % 24,
    minute: Number(read("minute")),
  };
}

export function inSleepWindow(
  now: Date,
  timeZone: string,
  window: { startHour: number; endHour: number } = SLEEP_WINDOW,
) {
  const { hour } = localClock(now, timeZone);
  return window.startHour <= window.endHour
    ? hour >= window.startHour && hour < window.endHour
    : hour >= window.startHour || hour < window.endHour;
}

/**
 * Whether tonight's update is due: it is the sleep window where the owner is,
 * and this local day has not been done yet. A failed run leaves the day
 * undone, so the next hourly check inside the window tries again.
 */
export function nightlyDue(
  now: Date,
  state: { timeZone?: string | null; consolidatedDay?: string | null },
): { due: boolean; day: string; reason: "due" | "outside_window" | "already_done" } {
  const timeZone = resolveTimeZone(state.timeZone);
  const { day } = localClock(now, timeZone);
  if (!inSleepWindow(now, timeZone)) return { due: false, day, reason: "outside_window" };
  if (state.consolidatedDay === day) return { due: false, day, reason: "already_done" };
  return { due: true, day, reason: "due" };
}
