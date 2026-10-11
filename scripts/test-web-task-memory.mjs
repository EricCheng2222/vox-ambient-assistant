import assert from "node:assert/strict";

const { webTaskRecord, recentWebTask, webTaskForDecision, followUpGoal, asksToRetry, WEB_TASK_FOLLOW_UP_MS } = await import("../lib/web-task-memory.ts");

const now = Date.UTC(2026, 9, 10, 12, 42);
const hotels = "Use computer used to find hotels around October 31 for one night in Taipei xinyi";

// Stored and read back, while it is recent.
const record = webTaskRecord(`  ${hotels}  `, "stopped", now - 2 * 60_000, "It took 18 steps without finishing, so it stopped here.");
assert.deepEqual(record, { goal: hotels, outcome: "stopped", at: now - 2 * 60_000, answer: "It took 18 steps without finishing, so it stopped here." });
assert.deepEqual(recentWebTask(JSON.stringify(record), now), record);
assert.equal(webTaskRecord(hotels, "running", now).answer, undefined);
assert.equal(webTaskRecord("x".repeat(900), "done", now, "y".repeat(900)).goal.length, 600);
assert.equal(webTaskRecord(hotels, "done", now, "y".repeat(900)).answer.length, 400);

// Too old, from the future, malformed, or not there: no task to refer to.
assert.equal(recentWebTask(JSON.stringify({ ...record, at: now - WEB_TASK_FOLLOW_UP_MS - 1 }), now), null);
assert.equal(recentWebTask(JSON.stringify({ ...record, at: now + 10 * 60_000 }), now), null);
assert.equal(recentWebTask(JSON.stringify({ ...record, outcome: "exploded" }), now), null);
assert.equal(recentWebTask(JSON.stringify({ ...record, goal: "x" }), now), null);
assert.equal(recentWebTask("{not json", now), null);
assert.equal(recentWebTask(null, now), null);
assert.equal(recentWebTask("[]", now), null);

// What the routing decision is told.
assert.deepEqual(webTaskForDecision(record, now), { request: hotels, outcome: "it stopped without finishing", minutes_ago: 2 });

// The goal the browser gets for a follow-up: the new words, then what they refer to.
const goal = followUpGoal("Search again for hotel", record);
assert.ok(goal.startsWith("Search again for hotel\n\n"));
assert.ok(goal.includes(`“${hotels}”`));
assert.match(goal, /Last time it stopped without finishing: “It took 18 steps/u);
assert.match(goal, /Carry out the earlier request again, with whatever the new words change\.$/u);
assert.ok(followUpGoal("try November 1 instead", { ...record, answer: undefined }).includes("Last time it stopped without finishing."));
assert.ok(followUpGoal("x".repeat(3000), record).length <= 1200);

// The words alone, for when the routing decision could not be asked.
for (const text of ["Search again for hotel", "try again", "retry", "do it once more", "keep going", "continue", "再找一次", "再試一次", "重新搜尋", "繼續"]) assert.equal(asksToRetry(text), true, text);
for (const text of ["what's the weather tomorrow", "find hotels in Tokyo", "thanks", "幫我查明天天氣", "against all odds"]) assert.equal(asksToRetry(text), false, text);

console.log("web task memory: ok");
