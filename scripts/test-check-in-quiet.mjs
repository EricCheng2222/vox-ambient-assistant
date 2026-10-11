import assert from "node:assert/strict";
const { readQuiet, putOff, neverAgain, quietIds, LATER_MS } = await import("../lib/check-in-quiet.ts");

const now = Date.UTC(2026, 9, 11, 3, 0);
const empty = readQuiet(null, now);
assert.deepEqual(empty, { never: [], later: {} });
assert.deepEqual(readQuiet("{not json", now), { never: [], later: {} });
assert.deepEqual(readQuiet(JSON.stringify({ never: "x", later: [1] }), now), { never: [], later: {} });

// Later: out of sight for three hours, under both names, then back.
const later = putOff(empty, "check:study", now);
assert.deepEqual(quietIds(later).sort(), ["check:study", "study"]);
const stored = JSON.stringify(later);
assert.deepEqual(quietIds(readQuiet(stored, now + LATER_MS - 1)).sort(), ["check:study", "study"]);
assert.deepEqual(quietIds(readQuiet(stored, now + LATER_MS + 1)), []);

// Don't show again: for good, and no longer waiting on a timer.
const never = neverAgain(later, "check:study");
assert.deepEqual(never, { never: ["check:study", "study"], later: {} });
assert.deepEqual(quietIds(readQuiet(JSON.stringify(never), now + 400 * 24 * 60 * 60_000)).sort(), ["check:study", "study"]);
// One notice switched off leaves the others alone; switching it off twice changes nothing.
assert.deepEqual(neverAgain(never, "check:study"), never);
assert.deepEqual(quietIds(neverAgain(putOff(empty, "check:rsvp:abc", now), "check:study")).sort(), ["check:rsvp:abc", "check:study", "rsvp:abc", "study"]);
console.log("check-in quiet: ok");
