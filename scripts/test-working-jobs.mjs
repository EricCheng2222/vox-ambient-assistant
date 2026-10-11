import assert from "node:assert/strict";

const { cleanWorkingJobs, elapsedLabel, WORKING_JOB_MAX_MS } = await import("../lib/working-jobs.ts");

const now = 1_800_000_000_000;
const id = "0f23d544-23f8-49fc-9dab-7547020b2304";
// What is remembered: a label and a start time, nothing else, and only while it could still be running.
assert.deepEqual(cleanWorkingJobs([{ id, label: "  Find me   a stay in Taipei ", kind: "mac", startedAt: now - 60_000, secret: "x" }], now), [{ id, label: "Find me a stay in Taipei", kind: "mac", startedAt: now - 60_000 }]);
assert.deepEqual(cleanWorkingJobs([{ id, label: "old", kind: "answer", startedAt: now - WORKING_JOB_MAX_MS - 1 }], now), [], "a leftover from long ago is dropped");
assert.deepEqual(cleanWorkingJobs([{ id: "nope", label: "x", startedAt: now }, { id, startedAt: "soon" }, null, "junk"], now), []);
assert.equal(cleanWorkingJobs([{ id, label: "x", kind: "weird", startedAt: now }], now)[0].kind, "answer");
assert.equal(cleanWorkingJobs("not a list", now).length, 0);
assert.equal(cleanWorkingJobs(Array.from({ length: 10 }, (_, i) => ({ id: id.slice(0, 35) + (i % 10), label: String(i), startedAt: now })), now).length, 6);
assert.equal(elapsedLabel(12_400), "12s");
assert.equal(elapsedLabel(65_000), "1m 05s");
assert.equal(elapsedLabel(-5), "0s");

console.log("Working jobs checks passed.");
