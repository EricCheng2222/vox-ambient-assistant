import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// iOS only reports arriving at (or leaving) a place when it sees the crossing
// after the place was registered. Re-registering places on every reminders
// refresh swallowed arrivals, so both sides must leave armed places alone.
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [page, scheduler] = await Promise.all([
  read("app/page.tsx"),
  read("ios/VoxIOS/VoxIOS/LocationReminderScheduler.swift"),
]);

// Web: re-arm only when the place reminders changed (or every half hour).
assert.match(page, /if \(!force && last && last\.key === key && Date\.now\(\) - last\.at < 30 \* 60_000\) return;/u);
// A "phone me" reminder is never downgraded because its token didn't load.
assert.match(page, /if \(needsTokens && Object\.keys\(callTokens\)\.length === 0\) return;/u);
// Coming back to the app, and changing a saved place, always re-check.
assert.match(page, /visibilityState === "visible"\) void syncLocationReminders\(true\)/u);
assert.equal(page.match(/void syncLocationReminders\(true\)/gu).length, 4);

// iPhone: unchanged, still-armed reminders are kept; nothing is cleared wholesale
// except when permission is gone or no reminders remain.
assert.match(scheduler, /for reminder in reminders where previous\[reminder\.id\] == reminder\.signature/u);
assert.match(scheduler, /removePendingNotificationRequests\(withIdentifiers: pending\.filter \{ !isKept\(\$0\) \}\)/u);
assert.match(scheduler, /stopWatching \{ kept\[\$0\.reminderId\] == nil \}/u);
assert.doesNotMatch(scheduler, /\n        stopWatching \{ _ in true \}\n        guard !reminders\.isEmpty/u);
// The signature covers what the geofence depends on, including a saved place's coordinates.
assert.match(scheduler, /let parts = \[place, saved, leaving \? "leave" : "arrive", callToken \?\? "", title, notes \?\? ""\]/u);
console.log("Place reminder arming checks passed.");
