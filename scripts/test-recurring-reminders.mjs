import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const {
  claimRepeatingAlert,
  completeRepeatingOccurrence,
  firstOccurrence,
  nextOccurrence,
  occurrenceId,
  occurrenceToComplete,
  parseOccurrenceId,
  parseReminderRepeat,
  presetOfRepeat,
  reminderRepeatLabel,
  repeatFromExtraction,
  repeatFromPreset,
  restoreRepeatingOccurrence,
  rollRepeatingReminder,
  serializeReminderRepeat,
  upcomingOccurrences,
  zonedTimeToUtc,
} = await import("../lib/reminder-repeat.ts");

const TAIPEI = "Asia/Taipei";
const NEW_YORK = "America/New_York";
const iso = (value) => new Date(value).toISOString();

// ---------------------------------------------------------------------------
// The stored rule: one validated shape, never free text
// ---------------------------------------------------------------------------
{
  const daily = { freq: "daily", time: "08:00", zone: TAIPEI };
  assert.deepEqual(parseReminderRepeat(daily), daily);
  assert.deepEqual(parseReminderRepeat(JSON.stringify(daily)), daily);
  assert.equal(serializeReminderRepeat(daily), JSON.stringify(daily));
  assert.equal(serializeReminderRepeat(null), null);

  // Weekdays are sorted; all seven days is simply daily; unknown fields go.
  assert.deepEqual(parseReminderRepeat({ freq: "weekly", days: [4, 1], time: "19:00", zone: TAIPEI, extra: 1 }), {
    freq: "weekly",
    days: [1, 4],
    time: "19:00",
    zone: TAIPEI,
  });
  assert.deepEqual(parseReminderRepeat({ freq: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "07:00", zone: TAIPEI }), {
    freq: "daily",
    time: "07:00",
    zone: TAIPEI,
  });
  assert.deepEqual(parseReminderRepeat({ freq: "yearly", month: 2, monthDay: 29, time: "09:00", zone: TAIPEI, until: "2030-12-31" }), {
    freq: "yearly",
    month: 2,
    monthDay: 29,
    time: "09:00",
    zone: TAIPEI,
    until: "2030-12-31",
  });

  for (const bad of [
    null,
    "every day at 8",
    "{not json",
    [],
    { freq: "hourly", time: "08:00", zone: TAIPEI },
    { freq: "daily", time: "8:00", zone: TAIPEI },
    { freq: "daily", time: "24:00", zone: TAIPEI },
    { freq: "daily", time: "08:00", zone: "Mars/Olympus" },
    { freq: "daily", time: "08:00" },
    { freq: "daily", time: "08:00", zone: TAIPEI, days: [1] },
    { freq: "weekly", time: "08:00", zone: TAIPEI },
    { freq: "weekly", days: [], time: "08:00", zone: TAIPEI },
    { freq: "weekly", days: [7], time: "08:00", zone: TAIPEI },
    { freq: "weekly", days: [1, 1], time: "08:00", zone: TAIPEI },
    { freq: "weekly", days: [1.5], time: "08:00", zone: TAIPEI },
    { freq: "monthly", time: "08:00", zone: TAIPEI },
    { freq: "monthly", monthDay: 0, time: "08:00", zone: TAIPEI },
    { freq: "monthly", monthDay: 32, time: "08:00", zone: TAIPEI },
    { freq: "yearly", month: 13, monthDay: 1, time: "08:00", zone: TAIPEI },
    { freq: "yearly", month: 2, monthDay: 30, time: "08:00", zone: TAIPEI },
    { freq: "yearly", month: 4, monthDay: 31, time: "08:00", zone: TAIPEI },
    { freq: "daily", time: "08:00", zone: TAIPEI, until: "2026-02-30" },
    { freq: "daily", time: "08:00", zone: TAIPEI, until: "next year" },
  ]) {
    assert.equal(parseReminderRepeat(bad), null, `should refuse ${JSON.stringify(bad)}`);
  }
}

// ---------------------------------------------------------------------------
// Next occurrence
// ---------------------------------------------------------------------------
{
  // Taipei has no daylight saving: 08:00 is always 00:00 UTC.
  const daily = parseReminderRepeat({ freq: "daily", time: "08:00", zone: TAIPEI });
  assert.equal(nextOccurrence(daily, "2026-10-07T03:00:00Z"), "2026-10-08T00:00:00.000Z");
  assert.equal(nextOccurrence(daily, "2026-10-06T23:59:59Z"), "2026-10-07T00:00:00.000Z");
  // Strictly after: at the due instant itself, the next one is tomorrow.
  assert.equal(nextOccurrence(daily, "2026-10-07T00:00:00Z"), "2026-10-08T00:00:00.000Z");
  assert.equal(nextOccurrence(daily, "not a date"), null);

  // Daylight saving: "every day at 8am" stays 8am local on both sides.
  const nyDaily = parseReminderRepeat({ freq: "daily", time: "08:00", zone: NEW_YORK });
  // Spring forward, 8 March 2026: EST (UTC-5) becomes EDT (UTC-4).
  assert.equal(nextOccurrence(nyDaily, "2026-03-07T12:00:00Z"), "2026-03-07T13:00:00.000Z");
  assert.equal(nextOccurrence(nyDaily, "2026-03-07T13:00:00Z"), "2026-03-08T12:00:00.000Z");
  assert.equal(nextOccurrence(nyDaily, "2026-03-08T12:00:00Z"), "2026-03-09T12:00:00.000Z");
  // Fall back, 1 November 2026: EDT becomes EST.
  assert.equal(nextOccurrence(nyDaily, "2026-10-31T12:00:00Z"), "2026-11-01T13:00:00.000Z");
  assert.equal(nextOccurrence(nyDaily, "2026-11-01T13:00:00Z"), "2026-11-02T13:00:00.000Z");

  // A time the clocks skip (02:30 on spring-forward night) lands just after
  // the jump that day, and is back at 02:30 the next day.
  const nyGap = parseReminderRepeat({ freq: "daily", time: "02:30", zone: NEW_YORK });
  assert.equal(nextOccurrence(nyGap, "2026-03-07T08:00:00Z"), "2026-03-08T07:30:00.000Z"); // 03:30 EDT
  assert.equal(nextOccurrence(nyGap, "2026-03-08T07:30:00Z"), "2026-03-09T06:30:00.000Z"); // 02:30 EDT
  // A time that happens twice (01:30 on fall-back night) goes off once.
  const nyTwice = parseReminderRepeat({ freq: "daily", time: "01:30", zone: NEW_YORK });
  assert.equal(nextOccurrence(nyTwice, "2026-10-31T06:00:00Z"), "2026-11-01T05:30:00.000Z"); // first 01:30 (EDT)
  assert.equal(nextOccurrence(nyTwice, "2026-11-01T05:30:00Z"), "2026-11-02T06:30:00.000Z"); // not the second 01:30
  assert.equal(zonedTimeToUtc("2026-07-01", "08:00", "Europe/London"), Date.parse("2026-07-01T07:00:00Z"));

  // Weekdays: Friday's is followed by Monday's. 9 Oct 2026 is a Friday.
  const weekdays = parseReminderRepeat({ freq: "weekly", days: [1, 2, 3, 4, 5], time: "08:00", zone: TAIPEI });
  assert.equal(nextOccurrence(weekdays, "2026-10-09T00:00:00Z"), "2026-10-12T00:00:00.000Z");
  assert.equal(nextOccurrence(weekdays, "2026-10-10T05:00:00Z"), "2026-10-12T00:00:00.000Z");
  assert.equal(nextOccurrence(weekdays, "2026-10-12T00:00:00Z"), "2026-10-13T00:00:00.000Z");

  // Monday and Thursday at 7pm. 7 Oct 2026 is a Wednesday.
  const monThu = parseReminderRepeat({ freq: "weekly", days: [1, 4], time: "19:00", zone: TAIPEI });
  assert.deepEqual(upcomingOccurrences(monThu, "2026-10-07T04:00:00Z", 4), [
    "2026-10-08T11:00:00.000Z",
    "2026-10-12T11:00:00.000Z",
    "2026-10-15T11:00:00.000Z",
    "2026-10-19T11:00:00.000Z",
  ]);
  // The weekday is the user's local one: Monday 07:00 in Taipei is still
  // Sunday in UTC.
  const monEarly = parseReminderRepeat({ freq: "weekly", days: [1], time: "07:00", zone: TAIPEI });
  assert.equal(nextOccurrence(monEarly, "2026-10-07T00:00:00Z"), "2026-10-11T23:00:00.000Z");

  // Monthly on the 31st falls on the last day of shorter months.
  const monthEnd = parseReminderRepeat({ freq: "monthly", monthDay: 31, time: "09:00", zone: TAIPEI });
  assert.deepEqual(upcomingOccurrences(monthEnd, "2027-01-01T00:00:00Z", 5), [
    "2027-01-31T01:00:00.000Z",
    "2027-02-28T01:00:00.000Z",
    "2027-03-31T01:00:00.000Z",
    "2027-04-30T01:00:00.000Z",
    "2027-05-31T01:00:00.000Z",
  ]);
  assert.equal(nextOccurrence(monthEnd, "2028-02-01T00:00:00Z"), "2028-02-29T01:00:00.000Z");
  const first = parseReminderRepeat({ freq: "monthly", monthDay: 1, time: "09:00", zone: TAIPEI });
  assert.equal(nextOccurrence(first, "2026-12-01T01:00:00Z"), "2027-01-01T01:00:00.000Z");

  // Yearly; 29 February is 28 February outside leap years.
  const march7 = parseReminderRepeat({ freq: "yearly", month: 3, monthDay: 7, time: "09:00", zone: TAIPEI });
  assert.equal(nextOccurrence(march7, "2026-10-07T00:00:00Z"), "2027-03-07T01:00:00.000Z");
  assert.equal(nextOccurrence(march7, "2027-03-07T01:00:00Z"), "2028-03-07T01:00:00.000Z");
  const leapDay = parseReminderRepeat({ freq: "yearly", month: 2, monthDay: 29, time: "09:00", zone: TAIPEI });
  assert.deepEqual(upcomingOccurrences(leapDay, "2026-10-07T00:00:00Z", 3), [
    "2027-02-28T01:00:00.000Z",
    "2028-02-29T01:00:00.000Z",
    "2029-02-28T01:00:00.000Z",
  ]);

  // End date: the last day it may happen, in the user's own calendar.
  const ending = parseReminderRepeat({ freq: "daily", time: "08:00", zone: TAIPEI, until: "2026-10-09" });
  assert.deepEqual(upcomingOccurrences(ending, "2026-10-07T03:00:00Z", 10), [
    "2026-10-08T00:00:00.000Z",
    "2026-10-09T00:00:00.000Z",
  ]);
  assert.equal(nextOccurrence(ending, "2026-10-09T00:00:00Z"), null);

  // A new rule starts after now, and not before its start date.
  const now = Date.parse("2026-10-07T03:00:00Z"); // Wed 11:00 in Taipei
  assert.equal(firstOccurrence(daily, null, now), "2026-10-08T00:00:00.000Z");
  assert.equal(firstOccurrence(daily, "2026-11-01", now), "2026-11-01T00:00:00.000Z");
  assert.equal(firstOccurrence(daily, "2026-01-01", now), "2026-10-08T00:00:00.000Z");
  assert.equal(firstOccurrence({ ...daily, until: "2026-10-01" }, null, now), null);
}

// ---------------------------------------------------------------------------
// What the model says about repeating is checked, never trusted
// ---------------------------------------------------------------------------
{
  const blank = { weekdays: [], month_day: null, month: null, time: "08:00", start_date: null, until: null };
  const rule = (value) => {
    const result = repeatFromExtraction(value, TAIPEI);
    assert.equal(result.kind, "rule", JSON.stringify(result));
    return result.rule;
  };
  assert.deepEqual(repeatFromExtraction(null, TAIPEI), { kind: "none" });
  assert.deepEqual(repeatFromExtraction(undefined, TAIPEI), { kind: "none" });
  assert.deepEqual(repeatFromExtraction({ ...blank, kind: "none" }, TAIPEI), { kind: "none" });

  // "remind me every weekday at 8 to take my medicine"
  assert.deepEqual(rule({ ...blank, kind: "weekdays" }), { freq: "weekly", days: [1, 2, 3, 4, 5], time: "08:00", zone: TAIPEI });
  // "every Monday and Thursday at 7pm"
  assert.deepEqual(rule({ ...blank, kind: "weekly", weekdays: ["thu", "mon"], time: "19:00" }), {
    freq: "weekly",
    days: [1, 4],
    time: "19:00",
    zone: TAIPEI,
  });
  // "on the 1st of every month" (no time given: 09:00)
  assert.deepEqual(rule({ ...blank, kind: "monthly", month_day: 1, time: null }), {
    freq: "monthly",
    monthDay: 1,
    time: "09:00",
    zone: TAIPEI,
  });
  // "every year on March 7"
  assert.deepEqual(rule({ ...blank, kind: "yearly", month: 3, month_day: 7, time: "09:00" }), {
    freq: "yearly",
    month: 3,
    monthDay: 7,
    time: "09:00",
    zone: TAIPEI,
  });
  // 每天早上八點提醒我吃藥
  assert.deepEqual(rule({ ...blank, kind: "daily" }), { freq: "daily", time: "08:00", zone: TAIPEI });
  // 每週一三五
  assert.deepEqual(rule({ ...blank, kind: "weekly", weekdays: ["mon", "wed", "fri"], time: "09:00" }), {
    freq: "weekly",
    days: [1, 3, 5],
    time: "09:00",
    zone: TAIPEI,
  });
  // The rule is worked out in the zone it was given.
  assert.equal(rule({ ...blank, kind: "daily" }, NEW_YORK).zone, TAIPEI);
  assert.equal(repeatFromExtraction({ ...blank, kind: "daily" }, NEW_YORK).rule.zone, NEW_YORK);
  // Start and end dates.
  const bounded = repeatFromExtraction({ ...blank, kind: "daily", start_date: "2026-11-01", until: "2026-12-31" }, TAIPEI);
  assert.equal(bounded.startDate, "2026-11-01");
  assert.equal(bounded.rule.until, "2026-12-31");

  // Anything that can't be kept exactly is refused, with a question to ask.
  for (const bad of [
    "every day",
    [],
    { ...blank, kind: "unsupported" },
    { ...blank, kind: "fortnightly" },
    { ...blank },
    { ...blank, kind: "weekly" },
    { ...blank, kind: "weekly", weekdays: ["monday"] },
    { ...blank, kind: "weekly", weekdays: ["mon", "funday"] },
    { ...blank, kind: "monthly" },
    { ...blank, kind: "monthly", month_day: 32 },
    { ...blank, kind: "monthly", month_day: "1" },
    { ...blank, kind: "yearly", month_day: 7 },
    { ...blank, kind: "yearly", month: 2, month_day: 30 },
    { ...blank, kind: "daily", time: "8am" },
    { ...blank, kind: "daily", time: "25:00" },
    { ...blank, kind: "daily", until: "someday" },
    { ...blank, kind: "daily", start_date: "2026-13-01" },
  ]) {
    const result = repeatFromExtraction(bad, TAIPEI);
    assert.equal(result.kind, "invalid", `should refuse ${JSON.stringify(bad)}`);
    assert.ok(result.reason.length > 10);
  }
}

// ---------------------------------------------------------------------------
// Choosing a repeat from the menu
// ---------------------------------------------------------------------------
{
  const due = "2026-10-07T11:30:00.000Z"; // Wed 7 Oct 2026, 19:30 in Taipei
  assert.equal(repeatFromPreset("none", due, TAIPEI), null);
  assert.deepEqual(repeatFromPreset("daily", due, TAIPEI), { freq: "daily", time: "19:30", zone: TAIPEI });
  assert.deepEqual(repeatFromPreset("weekdays", due, TAIPEI), { freq: "weekly", days: [1, 2, 3, 4, 5], time: "19:30", zone: TAIPEI });
  assert.deepEqual(repeatFromPreset("weekly", due, TAIPEI), { freq: "weekly", days: [3], time: "19:30", zone: TAIPEI });
  assert.deepEqual(repeatFromPreset("monthly", due, TAIPEI), { freq: "monthly", monthDay: 7, time: "19:30", zone: TAIPEI });
  assert.deepEqual(repeatFromPreset("yearly", due, TAIPEI), { freq: "yearly", month: 10, monthDay: 7, time: "19:30", zone: TAIPEI });
  // The local date and time, not the UTC one: 23:30 UTC is already the 8th in Taipei.
  assert.deepEqual(repeatFromPreset("monthly", "2026-10-07T23:30:00.000Z", TAIPEI), { freq: "monthly", monthDay: 8, time: "07:30", zone: TAIPEI });
  // Changing an existing rule keeps its time, zone, and end date even when the
  // due time is a snooze.
  const existing = { freq: "weekly", days: [1, 4], time: "08:00", zone: NEW_YORK, until: "2027-01-01" };
  assert.deepEqual(repeatFromPreset("daily", due, TAIPEI, existing), { freq: "daily", time: "08:00", zone: NEW_YORK, until: "2027-01-01" });
  assert.deepEqual(repeatFromPreset("weekly", due, TAIPEI, existing).days, [1, 4]);
  assert.equal(repeatFromPreset("daily", "garbage", TAIPEI), null);
  assert.equal(presetOfRepeat(null), "none");
  assert.equal(presetOfRepeat(repeatFromPreset("weekdays", due, TAIPEI)), "weekdays");
  assert.equal(presetOfRepeat(repeatFromPreset("weekly", due, TAIPEI)), "weekly");
}

// ---------------------------------------------------------------------------
// Going off: once per occurrence, then on to the next; no burst after a gap
// ---------------------------------------------------------------------------
const daily8 = parseReminderRepeat({ freq: "daily", time: "08:00", zone: TAIPEI });
const fresh = (dueAt, extra = {}) => ({
  dueAt,
  notifiedAt: null,
  lastOccurrenceAt: null,
  delivery: "app",
  callStatus: null,
  callAttempts: 0,
  ...extra,
});
const apply = (state, change) => {
  const next = { ...state };
  if (!change) return next;
  for (const key of ["dueAt", "notifiedAt", "lastOccurrenceAt"]) {
    if (change[key] !== undefined) next[key] = change[key];
  }
  if (change.resetCall) Object.assign(next, { callStatus: null, callAttempts: 0 });
  return next;
};
{
  const due = "2026-10-07T00:00:00.000Z";
  // Not due yet: nothing.
  assert.deepEqual(claimRepeatingAlert(daily8, fresh(due), Date.parse(due) - 1), { alert: false, change: null });
  assert.equal(rollRepeatingReminder(daily8, fresh(due), Date.parse(due) - 1), null);

  // Due: alerts once and moves to tomorrow.
  const at = Date.parse(due) + 5_000;
  const first = claimRepeatingAlert(daily8, fresh(due), at);
  assert.equal(first.alert, true);
  assert.deepEqual(first.change, {
    dueAt: "2026-10-08T00:00:00.000Z",
    lastOccurrenceAt: due,
    resetCall: true,
    notifiedAt: iso(at),
  });
  // A second app asking right after gets nothing: no double alert.
  const after = apply(fresh(due), first.change);
  assert.deepEqual(claimRepeatingAlert(daily8, after, at + 10_000), { alert: false, change: null });
  assert.equal(rollRepeatingReminder(daily8, after, at + 10_000), null);
  // ...and it alerts again the next day.
  assert.equal(claimRepeatingAlert(daily8, after, Date.parse("2026-10-08T00:00:01Z")).alert, true);

  // Nothing ran for five days: one alert, then straight to the next future
  // occurrence. Never one alert per missed day.
  const late = Date.parse("2026-10-12T03:00:00Z");
  const caughtUp = claimRepeatingAlert(daily8, fresh(due), late);
  assert.equal(caughtUp.alert, true);
  assert.equal(caughtUp.change.dueAt, "2026-10-13T00:00:00.000Z");
  const settled = apply(fresh(due), caughtUp.change);
  assert.deepEqual(claimRepeatingAlert(daily8, settled, late + 15_000), { alert: false, change: null });

  // The scheduler moved it on before any app was open: the alert for the
  // occurrence that passed is still owed, exactly once.
  const rolled = rollRepeatingReminder(daily8, fresh(due), at);
  assert.deepEqual(rolled, { dueAt: "2026-10-08T00:00:00.000Z", lastOccurrenceAt: due, resetCall: true });
  const afterRoll = apply(fresh(due), rolled);
  const owed = claimRepeatingAlert(daily8, afterRoll, at + 20_000);
  assert.deepEqual(owed, { alert: true, change: { notifiedAt: iso(at + 20_000) } });
  assert.deepEqual(claimRepeatingAlert(daily8, apply(afterRoll, owed.change), at + 40_000), { alert: false, change: null });
  // The scheduler catching up after days also jumps to the future in one step.
  assert.equal(rollRepeatingReminder(daily8, fresh(due), late).dueAt, "2026-10-13T00:00:00.000Z");

  // The last occurrence of a series alerts once and stays put, like a
  // one-time reminder, until it is marked done.
  const ending = parseReminderRepeat({ freq: "daily", time: "08:00", zone: TAIPEI, until: "2026-10-07" });
  const last = claimRepeatingAlert(ending, fresh(due), at);
  assert.deepEqual(last, { alert: true, change: { notifiedAt: iso(at) } });
  assert.deepEqual(claimRepeatingAlert(ending, apply(fresh(due), last.change), at + 15_000), { alert: false, change: null });
  assert.equal(rollRepeatingReminder(ending, fresh(due), at), null);
  assert.deepEqual(completeRepeatingOccurrence(ending, apply(fresh(due), last.change), null, at + 60_000), {
    finish: true,
    lastOccurrenceAt: null,
  });
}

// Phone-call reminders: the call and the app alert each happen once per
// occurrence, whichever comes first, and the series moves on afterwards.
{
  const due = "2026-10-07T00:00:00.000Z";
  const at = Date.parse(due) + 5_000;
  const call = fresh(due, { delivery: "call" });
  // The app alerts but leaves the reminder due, so the scheduler can still call.
  const claimed = claimRepeatingAlert(daily8, call, at);
  assert.deepEqual(claimed, { alert: true, change: { notifiedAt: iso(at) } });
  const waiting = apply(call, claimed.change);
  assert.equal(rollRepeatingReminder(daily8, waiting, at + 20_000), null);
  assert.equal(rollRepeatingReminder(daily8, { ...waiting, callStatus: "calling", callAttempts: 1 }, at + 20_000), null);
  assert.equal(rollRepeatingReminder(daily8, { ...waiting, callStatus: "failed", callAttempts: 2 }, at + 20_000), null);
  // Called (or given up on): it moves on, ready to be called next time.
  for (const settled of [
    { callStatus: "called", callAttempts: 1 },
    { callStatus: "failed", callAttempts: 3 },
    { callStatus: "unavailable", callAttempts: 0 },
    { callStatus: "missed", callAttempts: 0 },
  ]) {
    const change = rollRepeatingReminder(daily8, { ...waiting, ...settled }, at + 60_000);
    assert.deepEqual(change, { dueAt: "2026-10-08T00:00:00.000Z", lastOccurrenceAt: due, resetCall: true });
    const next = apply({ ...waiting, ...settled }, change);
    assert.equal(next.callStatus, null);
    assert.equal(next.callAttempts, 0);
    // The app already alerted for this occurrence: no second alert.
    assert.deepEqual(claimRepeatingAlert(daily8, next, at + 90_000), { alert: false, change: null });
  }
  // The call happened first: the app alert is still owed once afterwards.
  const calledFirst = apply({ ...call, callStatus: "called", callAttempts: 1 }, rollRepeatingReminder(daily8, { ...call, callStatus: "called", callAttempts: 1 }, at));
  assert.equal(claimRepeatingAlert(daily8, calledFirst, at + 30_000).alert, true);
  // No scheduler at all (a call that never comes): after the call window the
  // app moves it on itself, so the series is never stuck.
  const stuck = claimRepeatingAlert(daily8, waiting, Date.parse(due) + 31 * 60_000);
  assert.equal(stuck.alert, false);
  assert.equal(stuck.change.dueAt, "2026-10-08T00:00:00.000Z");
}

// ---------------------------------------------------------------------------
// Done finishes one occurrence, never the series
// ---------------------------------------------------------------------------
{
  const due = "2026-10-07T00:00:00.000Z";
  const tomorrow = "2026-10-08T00:00:00.000Z";
  const at = Date.parse(due) + 5 * 60_000;

  // Done after it went off and moved on: ticks it off, the next one stands.
  const wentOff = fresh(tomorrow, { lastOccurrenceAt: due, notifiedAt: iso(Date.parse(due) + 5_000) });
  assert.equal(occurrenceToComplete(wentOff, at), due);
  assert.deepEqual(completeRepeatingOccurrence(daily8, wentOff, null, at), { lastOccurrenceAt: null, notifiedAt: iso(at) });
  assert.deepEqual(completeRepeatingOccurrence(daily8, wentOff, due, at), { lastOccurrenceAt: null, notifiedAt: iso(at) });
  // Done from the iPhone before any app alerted: no late alert afterwards.
  const unseen = fresh(tomorrow, { lastOccurrenceAt: due });
  const ticked = apply(unseen, completeRepeatingOccurrence(daily8, unseen, due, at));
  assert.deepEqual(claimRepeatingAlert(daily8, ticked, at + 15_000), { alert: false, change: null });
  assert.equal(ticked.dueAt, tomorrow);

  // Done while it is due (nothing has moved it yet): on to tomorrow, no alert.
  const overdue = fresh(due);
  assert.equal(occurrenceToComplete(overdue, at), due);
  const done = completeRepeatingOccurrence(daily8, overdue, due, at);
  assert.deepEqual(done, { dueAt: tomorrow, lastOccurrenceAt: null, resetCall: true, notifiedAt: iso(at) });
  assert.deepEqual(claimRepeatingAlert(daily8, apply(overdue, done), at + 15_000), { alert: false, change: null });

  // Done ahead of time skips just the upcoming one; it still alerts after that.
  const early = Date.parse(due) - 10 * 60_000;
  const skipped = completeRepeatingOccurrence(daily8, fresh(due), null, early);
  assert.deepEqual(skipped, { dueAt: tomorrow, lastOccurrenceAt: null, resetCall: true });
  assert.equal(claimRepeatingAlert(daily8, apply(fresh(due), skipped), Date.parse(tomorrow) + 1).alert, true);
  // Undo puts it back; an occurrence that has passed can't come back.
  const afterSkip = apply(fresh(due), skipped);
  assert.deepEqual(restoreRepeatingOccurrence(afterSkip, due, early), { dueAt: due, resetCall: true });
  assert.equal(restoreRepeatingOccurrence(afterSkip, due, Date.parse(due) + 1), null);
  assert.equal(restoreRepeatingOccurrence(afterSkip, "2026-10-09T00:00:00.000Z", early), null);
  assert.equal(restoreRepeatingOccurrence(afterSkip, "nonsense", early), null);

  // A stale "Done" (an old notification for an occurrence long gone) changes
  // nothing: in particular it never skips a future occurrence.
  assert.equal(completeRepeatingOccurrence(daily8, fresh(tomorrow), "2026-10-01T00:00:00.000Z", at), null);
  assert.equal(completeRepeatingOccurrence(daily8, wentOff, "2026-10-01T00:00:00.000Z", at), null);
  // Done twice on the same occurrence does it once.
  const once = apply(wentOff, completeRepeatingOccurrence(daily8, wentOff, due, at));
  assert.equal(completeRepeatingOccurrence(daily8, once, due, at + 1_000), null);

  // The iPhone names the occurrence in the notification's id.
  const id = "0b9d5c1e-6f3a-4a57-9d47-0d6a3c1f2b11";
  const packed = occurrenceId(id, due);
  assert.match(packed, /^[A-Za-z0-9-]{8,64}$/u); // what the iPhone app accepts
  assert.deepEqual(parseOccurrenceId(packed), { id, occurrence: due });
  assert.deepEqual(parseOccurrenceId(id), { id, occurrence: null });
  assert.deepEqual(parseOccurrenceId("short"), { id: "short", occurrence: null });
  assert.notEqual(occurrenceId(id, due), occurrenceId(id, tomorrow));
}

// ---------------------------------------------------------------------------
// Wording: spoken and shown, English and Taiwan Mandarin
// ---------------------------------------------------------------------------
{
  const label = (rule, language, style) => reminderRepeatLabel(parseReminderRepeat({ zone: TAIPEI, ...rule }), language, style);
  const weekdays = { freq: "weekly", days: [1, 2, 3, 4, 5], time: "08:00" };
  assert.equal(label(weekdays, "english", "spoken"), "Every weekday at 8:00 AM");
  assert.equal(label(weekdays, "english", "short"), "Every weekday, 08:00");
  assert.equal(label(weekdays), "Every weekday, 08:00");
  assert.equal(label(weekdays, "taiwan_mandarin", "spoken"), "每個平日上午8:00");
  assert.equal(label(weekdays, "taiwan_mandarin", "short"), "每個平日 08:00");

  const daily = { freq: "daily", time: "08:00" };
  assert.equal(label(daily, "english", "spoken"), "Every day at 8:00 AM");
  assert.equal(label(daily, "english", "short"), "Every day, 08:00");
  assert.equal(label(daily, "taiwan_mandarin", "spoken"), "每天上午8:00");
  assert.equal(label(daily, "taiwan_mandarin", "short"), "每天 08:00");

  const monThu = { freq: "weekly", days: [1, 4], time: "19:00" };
  assert.equal(label(monThu, "english", "spoken"), "Every Monday and Thursday at 7:00 PM");
  assert.equal(label(monThu, "english", "short"), "Every Mon, Thu, 19:00");
  assert.equal(label(monThu, "taiwan_mandarin", "spoken"), "每週一、四下午7:00");
  const monWedFri = { freq: "weekly", days: [1, 3, 5], time: "09:00" };
  assert.equal(label(monWedFri, "english", "spoken"), "Every Monday, Wednesday, and Friday at 9:00 AM");
  assert.equal(label(monWedFri, "taiwan_mandarin", "short"), "每週一、三、五 09:00");
  // One day is spelled out; the week reads Monday to Sunday.
  assert.equal(label({ freq: "weekly", days: [2], time: "12:30" }, "english", "short"), "Every Tuesday, 12:30");
  assert.equal(label({ freq: "weekly", days: [0, 3], time: "00:05" }, "english", "spoken"), "Every Wednesday and Sunday at 12:05 AM");
  assert.equal(label({ freq: "weekly", days: [0, 6], time: "10:00" }, "english", "short"), "Every weekend, 10:00");
  assert.equal(label({ freq: "weekly", days: [0, 6], time: "10:00" }, "taiwan_mandarin", "short"), "每個週末 10:00");

  const first = { freq: "monthly", monthDay: 1, time: "09:00" };
  assert.equal(label(first, "english", "spoken"), "Every month on the 1st at 9:00 AM");
  assert.equal(label(first, "english", "short"), "Every month on the 1st, 09:00");
  assert.equal(label(first, "taiwan_mandarin", "spoken"), "每月1號上午9:00");
  assert.equal(label({ freq: "monthly", monthDay: 22, time: "09:00" }, "english", "short"), "Every month on the 22nd, 09:00");
  assert.equal(label({ freq: "monthly", monthDay: 13, time: "09:00" }, "english", "short"), "Every month on the 13th, 09:00");
  assert.equal(label({ freq: "monthly", monthDay: 3, time: "12:00" }, "english", "spoken"), "Every month on the 3rd at 12:00 PM");
  assert.equal(label({ freq: "monthly", monthDay: 31, time: "09:00" }, "english", "short"), "Every month on the last day, 09:00");
  assert.equal(label({ freq: "monthly", monthDay: 31, time: "09:00" }, "taiwan_mandarin", "short"), "每月最後一天 09:00");

  const march7 = { freq: "yearly", month: 3, monthDay: 7, time: "09:00" };
  assert.equal(label(march7, "english", "spoken"), "Every year on March 7 at 9:00 AM");
  assert.equal(label(march7, "english", "short"), "Every year on Mar 7, 09:00");
  assert.equal(label(march7, "taiwan_mandarin", "spoken"), "每年3月7日上午9:00");
  assert.equal(label(march7, "taiwan_mandarin", "short"), "每年3月7日 09:00");

  const ending = { ...daily, until: "2026-12-31" };
  assert.equal(label(ending, "english", "spoken"), "Every day at 8:00 AM, until December 31, 2026");
  assert.equal(label(ending, "english", "short"), "Every day, 08:00, until Dec 31, 2026");
  assert.equal(label(ending, "taiwan_mandarin", "spoken"), "每天上午8:00，到2026年12月31日為止");
}

// ---------------------------------------------------------------------------
// The real store, on SQLite, with every migration applied
// ---------------------------------------------------------------------------
const root = fileURLToPath(new URL("..", import.meta.url));
const sqlite = new DatabaseSync(":memory:");
for (const file of (await readdir(`${root}drizzle`)).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of (await readFile(`${root}drizzle/${file}`, "utf8")).split("--> statement-breakpoint")) {
    if (statement.trim()) sqlite.exec(statement);
  }
}
const columns = sqlite.prepare("PRAGMA table_info(reminders)").all().map((column) => column.name);
assert.ok(columns.includes("repeat_rule") && columns.includes("last_occurrence_at"));
const migration = await readFile(`${root}drizzle/0025_recurring_reminders.sql`, "utf8");
// Only adds nullable columns: every existing reminder stays a one-time reminder.
assert.deepEqual(
  migration.split("--> statement-breakpoint").map((statement) => statement.trim()),
  ["ALTER TABLE `reminders` ADD `repeat_rule` text;", "ALTER TABLE `reminders` ADD `last_occurrence_at` text;"],
);

// "@/..." imports resolve to this repo; "@/db" is the in-memory database.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/db") {
      return { url: "data:text/javascript,export const getDb = () => globalThis.__voxTestDb;", shortCircuit: true };
    }
    if (specifier.startsWith("@/")) {
      const base = `${root}${specifier.slice(2)}`;
      const path = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((candidate) => existsSync(candidate));
      if (path) return { url: pathToFileURL(path).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { drizzle } = await import("drizzle-orm/sqlite-proxy");
globalThis.__voxTestDb = drizzle(async (sql, params, method) => {
  const statement = sqlite.prepare(sql);
  statement.setReturnArrays(true);
  if (method === "run") {
    statement.run(...params);
    return { rows: [] };
  }
  const rows = statement.all(...params);
  return { rows: method === "get" ? rows[0] : rows };
});
const store = await import("../lib/reminder-store.ts");
const OWNER = "owner";
const raw = (id) => sqlite.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
const setRaw = (id, fields) => {
  const keys = Object.keys(fields);
  sqlite.prepare(`UPDATE reminders SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`).run(...keys.map((key) => fields[key]), id);
};

// No stored zone: the app default. The device's own zone wins once recorded.
assert.equal(await store.reminderTimeZone(OWNER), TAIPEI);
sqlite.prepare("INSERT INTO user_profiles (owner_id, time_zone, time_zone_source) VALUES (?, ?, 'device')").run("traveller", NEW_YORK);
sqlite.prepare("INSERT INTO user_profiles (owner_id, time_zone) VALUES (?, ?)").run("broken", "Not/AZone");
assert.equal(await store.reminderTimeZone("traveller"), NEW_YORK);
assert.equal(await store.reminderTimeZone("broken"), TAIPEI);

{
  // A reminder saved before this change (no rule) is a one-time reminder and
  // behaves exactly as before.
  sqlite
    .prepare("INSERT INTO reminders (id, owner_id, title, due_at) VALUES (?, ?, ?, ?)")
    .run("legacy-reminder-1", OWNER, "Old one-off", "2026-10-07T00:00:00.000Z");
  const now = new Date("2026-10-07T00:00:10Z");
  const [legacy] = await store.claimDueReminders(OWNER, now);
  assert.equal(legacy.id, "legacy-reminder-1");
  assert.equal(legacy.repeat, null);
  assert.equal(legacy.lastOccurrenceAt, null);
  assert.equal(legacy.dueAt, "2026-10-07T00:00:00.000Z");
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date(now.getTime() + 15_000)), []);
  assert.equal(await store.rollDueRepeatingReminders(new Date(now.getTime() + 60_000)), 0);
  assert.deepEqual(await store.completeReminderOccurrence(OWNER, "legacy-reminder-1", null, now), { kind: "not_repeating" });
  assert.equal((await store.updateReminderStatus(OWNER, "legacy-reminder-1", "completed")).status, "completed");
  sqlite.exec("DELETE FROM reminders");
}

{
  // Web and Mac: two apps poll at once; one alert per occurrence.
  const created = await store.createReminder(OWNER, { title: "Take medicine", dueAt: "2026-10-07T00:00:00.000Z", repeat: daily8 });
  assert.deepEqual(created.repeat, daily8);
  assert.equal(raw(created.id).repeat_rule, JSON.stringify(daily8));
  const now = new Date("2026-10-07T00:00:10Z");
  const [first, second] = await Promise.all([store.claimDueReminders(OWNER, now), store.claimDueReminders(OWNER, now)]);
  assert.equal(first.length + second.length, 1);
  const fired = [...first, ...second][0];
  assert.equal(fired.status, "pending");
  assert.equal(fired.dueAt, "2026-10-08T00:00:00.000Z");
  assert.equal(fired.lastOccurrenceAt, "2026-10-07T00:00:00.000Z");
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-07T00:00:25Z")), []);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-07T00:01:00Z")), 0);
  // It is still listed, still open, and goes off again tomorrow.
  assert.equal((await store.listReminders(OWNER))[0].dueAt, "2026-10-08T00:00:00.000Z");
  assert.equal((await store.claimDueReminders(OWNER, new Date("2026-10-08T00:00:05Z"))).length, 1);

  // Nothing ran for a week: one alert, then the next future occurrence.
  const late = new Date("2026-10-15T03:00:00Z");
  const burst = await store.claimDueReminders(OWNER, late);
  assert.equal(burst.length, 1);
  assert.equal(burst[0].dueAt, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date(late.getTime() + 15_000)), []);

  // Scheduler first (no app open), then an app: the alert is owed once.
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-16T00:00:30Z")), 1);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-16T00:01:30Z")), 0);
  assert.equal(raw(created.id).due_at, "2026-10-17T00:00:00.000Z");
  const owed = await store.claimDueReminders(OWNER, new Date("2026-10-16T00:02:00Z"));
  assert.equal(owed.length, 1);
  assert.equal(owed[0].dueAt, "2026-10-17T00:00:00.000Z");
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-16T00:02:15Z")), []);

  // Done: ticks off the one that went off; the series carries on.
  const acknowledged = await store.completeReminderOccurrence(OWNER, created.id, "2026-10-16T00:00:00.000Z", new Date("2026-10-16T00:05:00Z"));
  assert.equal(acknowledged.kind, "updated");
  assert.equal(acknowledged.reminder.status, "pending");
  assert.equal(acknowledged.reminder.lastOccurrenceAt, null);
  assert.equal(acknowledged.reminder.dueAt, "2026-10-17T00:00:00.000Z");
  // The same Done again (a second device, a repeated tap) changes nothing.
  const again = await store.completeReminderOccurrence(OWNER, created.id, "2026-10-16T00:00:00.000Z", new Date("2026-10-16T00:05:30Z"));
  assert.equal(again.kind, "unchanged");
  assert.equal(again.reminder.dueAt, "2026-10-17T00:00:00.000Z");
  // Done ahead of time skips one; undo puts it back.
  const skip = await store.completeReminderOccurrence(OWNER, created.id, null, new Date("2026-10-16T12:00:00Z"));
  assert.equal(skip.reminder.dueAt, "2026-10-18T00:00:00.000Z");
  const restored = await store.restoreReminderOccurrence(OWNER, created.id, "2026-10-17T00:00:00.000Z", new Date("2026-10-16T12:01:00Z"));
  assert.equal(restored.dueAt, "2026-10-17T00:00:00.000Z");
  assert.equal(await store.restoreReminderOccurrence(OWNER, created.id, "2026-10-16T00:00:00.000Z", new Date("2026-10-16T12:02:00Z")), null);

  // Snooze: alerts at the snoozed time, then returns to its own times.
  const snoozed = await store.postponeReminder(OWNER, created.id, "2026-10-16T12:10:00.000Z");
  assert.deepEqual(snoozed.repeat, daily8);
  const afterSnooze = await store.claimDueReminders(OWNER, new Date("2026-10-16T12:10:05Z"));
  assert.equal(afterSnooze.length, 1);
  assert.equal(afterSnooze[0].dueAt, "2026-10-17T00:00:00.000Z");

  // Deleting removes the whole series.
  assert.equal(await store.deleteReminder(OWNER, created.id), created.id);
  assert.deepEqual(await store.listReminders(OWNER), []);
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-20T00:00:05Z")), []);
}

{
  // Phone call: called once per occurrence, alerted once, then on to the next.
  const created = await store.createReminder(OWNER, { title: "Stand-up", dueAt: "2026-10-07T00:00:00.000Z", delivery: "call", repeat: daily8 });
  const appFirst = await store.claimDueReminders(OWNER, new Date("2026-10-07T00:00:05Z"));
  assert.equal(appFirst.length, 1);
  assert.equal(appFirst[0].dueAt, "2026-10-07T00:00:00.000Z"); // left due for the call
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-07T00:00:20Z")), 0);
  const toCall = await store.claimDueCallReminders(OWNER, new Date("2026-10-07T00:00:30Z"));
  assert.deepEqual(toCall.map((reminder) => reminder.id), [created.id]);
  assert.deepEqual(toCall[0].repeat, daily8);
  assert.deepEqual(await store.claimDueCallReminders(OWNER, new Date("2026-10-07T00:00:31Z")), []);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-07T00:00:32Z")), 0); // call in flight
  await store.recordReminderCall(created.id, true);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-07T00:00:40Z")), 1);
  let row = raw(created.id);
  assert.equal(row.due_at, "2026-10-08T00:00:00.000Z");
  assert.equal(row.call_status, null);
  assert.equal(row.call_attempts, 0);
  assert.equal(row.status, "pending");
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-07T00:00:45Z")), []);
  assert.deepEqual(await store.claimDueCallReminders(OWNER, new Date("2026-10-07T00:01:30Z")), []);

  // Next day the call comes first: the app alert is still owed once.
  assert.equal((await store.claimDueCallReminders(OWNER, new Date("2026-10-08T00:00:10Z"))).length, 1);
  await store.recordReminderCall(created.id, true);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-08T00:00:20Z")), 1);
  assert.equal((await store.claimDueReminders(OWNER, new Date("2026-10-08T00:00:30Z"))).length, 1);
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-08T00:00:45Z")), []);

  // A failed call is retried, then given up on, and the series still moves on.
  for (const second of ["10", "70", "130"]) {
    const at = new Date(Date.parse("2026-10-09T00:00:00Z") + Number(second) * 1000);
    assert.equal((await store.claimDueCallReminders(OWNER, at)).length, 1);
    await store.recordReminderCall(created.id, false);
    assert.equal(await store.rollDueRepeatingReminders(at), second === "130" ? 1 : 0);
  }
  assert.equal(raw(created.id).due_at, "2026-10-10T00:00:00.000Z");

  // The scheduler was down for days: the old call is marked missed, not
  // placed, and the reminder jumps to the next future occurrence.
  const late = new Date("2026-10-13T05:00:00Z");
  assert.deepEqual(await store.claimDueCallReminders(OWNER, late), []);
  assert.equal(raw(created.id).call_status, "missed");
  assert.equal(await store.rollDueRepeatingReminders(late), 1);
  row = raw(created.id);
  assert.equal(row.due_at, "2026-10-14T00:00:00.000Z");
  assert.equal(row.call_status, null);

  // Calls switched off when it comes due: still moves on.
  assert.equal((await store.markDueCallRemindersUnavailable(OWNER, new Date("2026-10-14T00:00:10Z"))).length, 1);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-14T00:00:11Z")), 1);
  assert.equal(raw(created.id).due_at, "2026-10-15T00:00:00.000Z");

  // Done before the call is placed: no call for that occurrence.
  const done = await store.completeReminderOccurrence(OWNER, created.id, "2026-10-15T00:00:00.000Z", new Date("2026-10-15T00:00:05Z"));
  assert.equal(done.reminder.dueAt, "2026-10-16T00:00:00.000Z");
  assert.deepEqual(await store.claimDueCallReminders(OWNER, new Date("2026-10-15T00:00:30Z")), []);
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-15T00:00:30Z")), []);
  await store.deleteReminder(OWNER, created.id);
}

{
  // The series ends: the last one stays open until done, then completes.
  const ending = parseReminderRepeat({ ...daily8, until: "2026-10-08" });
  const created = await store.createReminder(OWNER, { title: "Antibiotics", dueAt: "2026-10-07T00:00:00.000Z", repeat: ending });
  assert.equal((await store.claimDueReminders(OWNER, new Date("2026-10-07T00:00:05Z")))[0].dueAt, "2026-10-08T00:00:00.000Z");
  const last = await store.claimDueReminders(OWNER, new Date("2026-10-08T00:00:05Z"));
  assert.equal(last.length, 1);
  assert.equal(last[0].dueAt, "2026-10-08T00:00:00.000Z");
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-08T00:00:20Z")), []);
  assert.equal(await store.rollDueRepeatingReminders(new Date("2026-10-09T00:00:20Z")), 0);
  const finished = await store.completeReminderOccurrence(OWNER, created.id, null, new Date("2026-10-08T00:10:00Z"));
  assert.equal(finished.reminder.status, "completed");
  await store.deleteReminder(OWNER, created.id);
}

{
  // Setting, changing, and clearing the repeat on an existing reminder.
  const now = new Date("2026-10-07T03:00:00Z"); // Wed 11:00 in Taipei
  const created = await store.createReminder(OWNER, { title: "Water plants", dueAt: "2026-10-10T01:00:00.000Z" }); // Sat 09:00
  const build = (preset) => (current) => repeatFromPreset(preset, current.dueAt, TAIPEI, current.repeat);
  const weekly = await store.updateReminderRepeat(OWNER, created.id, build("weekly"), now);
  assert.deepEqual(weekly.repeat, { freq: "weekly", days: [6], time: "09:00", zone: TAIPEI });
  assert.equal(weekly.dueAt, "2026-10-10T01:00:00.000Z"); // already on the rule
  // Weekdays: Saturday isn't one, so it moves to Monday.
  const weekdays = await store.updateReminderRepeat(OWNER, created.id, build("weekdays"), now);
  assert.equal(weekdays.dueAt, "2026-10-12T01:00:00.000Z");
  const cleared = await store.updateReminderRepeat(OWNER, created.id, build("none"), now);
  assert.equal(cleared.repeat, null);
  assert.equal(cleared.dueAt, "2026-10-12T01:00:00.000Z");
  assert.equal(raw(created.id).repeat_rule, null);
  // An overdue one-time reminder made to repeat starts from its next time
  // rather than going off again for the past.
  setRaw(created.id, { due_at: "2026-10-06T01:00:00.000Z", notified_at: "2026-10-06T01:00:05.000Z" });
  const daily = await store.updateReminderRepeat(OWNER, created.id, build("daily"), now);
  assert.equal(daily.dueAt, "2026-10-08T01:00:00.000Z");
  assert.equal(daily.notifiedAt, null);
  assert.deepEqual(await store.claimDueReminders(OWNER, now), []);
  // A rule that no longer validates is read as a one-time reminder.
  setRaw(created.id, { repeat_rule: '{"freq":"sometimes"}' });
  assert.equal((await store.listReminders(OWNER))[0].repeat, null);
  assert.equal((await store.claimDueReminders(OWNER, new Date("2026-10-08T01:00:05Z"))).length, 1);
  assert.deepEqual(await store.claimDueReminders(OWNER, new Date("2026-10-08T01:00:20Z")), []);
  await store.deleteReminder(OWNER, created.id);

  // Place reminders never repeat.
  const place = await store.createReminder(OWNER, { title: "Buy milk", location: { place: "全聯", event: "arrive" }, repeat: daily8 });
  assert.equal(place.repeat, null);
  assert.equal(await store.updateReminderRepeat(OWNER, place.id, build("daily"), now), null);
  await store.deleteReminder(OWNER, place.id);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
const read = (path) => readFile(`${root}${path}`, "utf8");
const [route, dispatch, sipRoute, sipTools, phone, page, today, bridge] = await Promise.all([
  read("app/api/reminders/route.ts"),
  read("app/api/reminders/call-dispatch/route.ts"),
  read("app/api/openai/realtime-sip/internal/route.ts"),
  read("cloudflare/sip-call-durable-object.mjs"),
  read("lib/phone-assistant.ts"),
  read("app/page.tsx"),
  read("components/today-panel.tsx"),
  read("ios/VoxIOS/VoxIOS/ReminderNotificationBridge.swift"),
]);
// Every way of creating a reminder validates the repeat on the server.
for (const source of [route, sipRoute, phone]) {
  assert.match(source, /repeatFromExtraction\(/u);
  assert.match(source, /reminderTimeZone\(/u);
  assert.match(source, /firstOccurrence\(repeat\.rule, repeat\.startDate\)/u);
}
assert.match(route, /repeat: reminderRepeatExtractionSchema/u);
assert.match(route, /if \(repeat\.kind === "invalid"\) \{\s+return Response\.json\(\{ error: repeat\.reason \}, \{ status: 400 \}\);/u);
assert.match(sipTools, /required: \["title", "notes", "due_at", "call_me", "repeat"\]/u);
// Done goes through the per-occurrence path before the one-time path.
assert.ok(route.indexOf("completeReminderOccurrence(auth.user.id, id, occurrence)") < route.indexOf("updateReminderStatus(auth.user.id, id, status)"));
assert.match(route, /parseOccurrenceId\(/u);
// The scheduler places calls first, then moves repeating reminders on.
assert.ok(dispatch.indexOf("dispatchDueReminderCalls()") < dispatch.indexOf("rollDueRepeatingReminders()"));
// The page: spoken confirmation, list and Today labels, per-occurrence Done,
// and several occurrences ahead for the iPhone.
assert.match(page, /reminderRepeatLabel\(reminder\.repeat, turnLanguage, "spoken"\)/u);
assert.match(page, /\{reminderRepeatLabel\(reminder\.repeat\)\}/u);
assert.match(page, /repeat: reminderRepeatLabel\(reminder\.repeat\)/u);
assert.match(page, /occurrenceToComplete\(reminder\) : null/u);
assert.match(page, /id: repeat \? occurrenceId\(id, time\) : id/u);
assert.match(today, /vx-row-meta">\{plain\(reminder\.repeat, 32\)\}/u);
// The iPhone app schedules what the page sends, one notification per id, and
// sends that id back for "Mark as done".
assert.match(bridge, /identifier: identifierPrefix \+ reminder\.id/u);
assert.match(bridge, /\^\[A-Za-z0-9-\]\{8,64\}\$/u);
assert.match(bridge, /\["id": reminderId, "status": "completed"\]/u);

console.log("Recurring reminder checks passed.");
