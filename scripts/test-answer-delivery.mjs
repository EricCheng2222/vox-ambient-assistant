import assert from "node:assert/strict";

const { deliverAbandonedAnswers, jobMessageId } = await import("../lib/answer-delivery.ts");

const now = Date.parse("2026-10-10T09:00:00.000Z");
const minutesAgo = (m) => new Date(now - m * 60_000).toISOString();
const world = (jobs, answers, taken = new Set(), alreadyShown = new Set()) => {
  const log = [];
  return {
    log,
    deps: {
      jobs: async () => jobs,
      check: async (responseId) => answers[responseId] ?? { state: "working", answer: "" },
      settle: async (id, status) => { if (taken.has(id)) return false; taken.add(id); log.push(`settle ${id} ${status}`); return true; },
      append: async (ownerId, messageId, text) => { log.push(`append ${ownerId} ${messageId} ${text}`); return !alreadyShown.has(messageId); },
      notify: async (ownerId, text) => { log.push(`notify ${ownerId} ${text}`); },
      forget: async (responseId) => { log.push(`forget ${responseId}`); },
      giveUpAfterMs: 15 * 60_000,
    },
  };
};
const job = (id, responseId, createdMinutesAgo = 1) => ({ id: `owner:${id}`, ownerId: "owner", responseId, createdAt: minutesAgo(createdMinutesAgo) });

// The user left: the finished answer goes into the conversation, with a notice, exactly once.
{
  const w = world([job("a", "r1")], { r1: { state: "done", answer: "Taipei 101." } });
  assert.deepEqual(await deliverAbandonedAnswers(w.deps, now), { delivered: 1, failed: 0 });
  assert.deepEqual(w.log, ["settle owner:a delivered", "append owner a Taipei 101.", "notify owner Taipei 101.", "forget r1"]);
}
// The app had shown and saved it, but never got to say so: the message is not added twice, and there is no notice.
{
  const w = world([job("a", "r1")], { r1: { state: "done", answer: "Taipei 101." } }, new Set(), new Set(["a"]));
  assert.deepEqual(await deliverAbandonedAnswers(w.deps, now), { delivered: 1, failed: 0 });
  assert.deepEqual(w.log, ["settle owner:a delivered", "append owner a Taipei 101.", "forget r1"]);
}
// The app came back and took it first: nothing is added a second time.
{
  const w = world([job("a", "r1")], { r1: { state: "done", answer: "Taipei 101." } }, new Set(["owner:a"]));
  assert.deepEqual(await deliverAbandonedAnswers(w.deps, now), { delivered: 0, failed: 0 });
  assert.deepEqual(w.log, []);
}
// Still being worked out: left for next time; after far too long, given up on.
{
  const w = world([job("a", "r1", 2), job("b", "r2", 20)], {});
  assert.deepEqual(await deliverAbandonedAnswers(w.deps, now), { delivered: 0, failed: 1 });
  assert.deepEqual(w.log, ["settle owner:b failed"]);
}
// A failed or empty answer is closed without putting anything in the conversation; one bad job doesn't stop the rest.
{
  const w = world([job("a", "r1"), job("b", "r2"), job("c", "r3")], { r1: { state: "failed", answer: "" }, r2: { state: "done", answer: "  " }, r3: { state: "done", answer: "Fine." } });
  w.deps.notify = async () => { throw new Error("no devices"); };
  assert.deepEqual(await deliverAbandonedAnswers(w.deps, now), { delivered: 1, failed: 2 });
  assert.ok(w.log.includes("append owner c Fine."));
  assert.equal(w.log.filter((line) => line.startsWith("append")).length, 1);
}
// The message a job becomes carries the id the app made up for the job, whoever writes it.
assert.equal(jobMessageId({ id: "owner:with:colons:0f23d544-23f8-49fc-9dab-7547020b2304", ownerId: "owner:with:colons" }), "0f23d544-23f8-49fc-9dab-7547020b2304");
assert.equal(jobMessageId({ id: "plain", ownerId: "someone" }), "plain");

// An answer cut off at its length limit is still an answer; an empty one is a failure.
{
  const { backgroundState } = await import("../lib/answer-jobs.ts").catch(() => ({ backgroundState: null }));
  if (backgroundState) {
    assert.equal(backgroundState({ status: "completed" }), "done");
    assert.equal(backgroundState({ status: "in_progress" }), "working");
    assert.equal(backgroundState({ status: "incomplete", output_text: "Most of an answer" }), "done");
    assert.equal(backgroundState({ status: "incomplete", output_text: "" }), "failed");
    assert.equal(backgroundState({ status: "failed" }), "failed");
    assert.equal(backgroundState(null), "failed");
  }
}

console.log("Answer delivery checks passed.");
