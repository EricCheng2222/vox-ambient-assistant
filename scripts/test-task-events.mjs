import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { EventEncoder } from "@ag-ui/encoder";
import { createTaskRun, readTaskEvent, reduceTaskEvent } from "@vox/task-events";
import { taskEventResponse } from "../lib/task-event-stream.ts";
import { readTaskEventResponse } from "../lib/task-event-client.ts";
import { createCodexTaskRun } from "../desktop/VoxDesktop/src/codex-task-events.mjs";
import { createTaskEventRelay } from "../desktop/VoxDesktop/src/task-event-relay.mjs";
import { runBrowserTask } from "../desktop/VoxDesktop/src/browser-task.mjs";
import { encryptRemoteTaskProgress, encryptRemoteResult } from "../desktop/VoxDesktop/src/remote-control.mjs";
import { decryptRemoteTaskProgress, decryptRemoteResult } from "../lib/remote-control.ts";

const id = randomUUID();
const events = [];
const run = createTaskRun({ taskId: id, kind: "answer", emit: (event) => events.push(event), now: () => 123 });
run.start();
run.start();
run.progress("Searching");
run.progress("Preparing");
run.finish("找到 café 🌙", { status: "done", stage: { sources: [] } });
run.fail("Too late");
run.finish("Duplicate");
for (const event of events) EventSchema.parse(event);
assert.equal(events.filter((e) => e.type === EventType.RUN_STARTED).length, 1);
assert.equal(events.filter((e) => e.type === EventType.RUN_FINISHED).length, 1);
assert.equal(events.filter((e) => e.type === EventType.STEP_FINISHED).length, 2);
let state;
for (const event of events) {
  state = reduceTaskEvent(state, event, id);
  assert.equal(reduceTaskEvent(state, event, id), state, "duplicates are inert");
}
assert.equal(state.answer, "找到 café 🌙");
assert.equal(state.status, "completed");
assert.equal(reduceTaskEvent(state, events[0], id), state, "replay cannot reopen a completed task");
assert.equal(readTaskEvent(events[0], randomUUID()), null, "task isolation");
assert.equal(readTaskEvent({ ...events[0], threadId: "voice" }, id), null);
assert.equal(readTaskEvent({ ...events[0], type: EventType.TOOL_CALL_START }, id), null, "events never grant tool authority");
assert.equal(readTaskEvent({ ...events[0], timestamp: NaN }, id), null);
assert.equal(readTaskEvent({ ...events[0], metadata: { vox: { ...events[0].metadata.vox, sequence: -1 } } }, id), null);
let running = reduceTaskEvent(undefined, events[3], id);
assert.equal(reduceTaskEvent(running, events[1], id), running, "out-of-order observations are inert");
const reconnect = [];
createTaskRun({ taskId: id, kind: "answer", emit: (e) => reconnect.push(e) }).progress("Reconnected");
for (const event of reconnect) running = reduceTaskEvent(running, event, id);
assert.equal(running.phase, "Reconnected", "new subscriptions have their own sequence");

for (const [status, expected] of [["need_user", "needs_input"], ["need_sign_in", "needs_input"], ["need_approval", "needs_input"], ["stopped", "failed"], ["seen", "delivered"]]) {
  let projected;
  createTaskRun({ taskId: id, kind: "browser", emit: (e) => { EventSchema.parse(e); projected = reduceTaskEvent(projected, e, id); } }).finish("", { status });
  assert.equal(projected.status, expected);
}
let cancelled;
createTaskRun({ taskId: id, kind: "codex", emit: (e) => { EventSchema.parse(e); cancelled = reduceTaskEvent(cancelled, e, id); } }).fail("Cancelled", "CANCELLED");
assert.equal(cancelled.status, "cancelled");
assert.doesNotThrow(() => createTaskRun({ taskId: id, kind: "answer", emit: () => { throw new Error("renderer gone"); } }).finish("Done"));

// Public Codex progress does not expose commands, reasoning, paths, or queries.
const codexEvents = [];
const codex = createCodexTaskRun({ taskId: id, emit: (e) => codexEvents.push(e) });
codex.start();
for (const type of ["reasoning", "command_execution", "file_change", "web_search", "mcp_tool_call"]) codex.accept({ type: "item.completed", item: { type, text: "PRIVATE_PAYLOAD", command: "PRIVATE_COMMAND", path: "/PRIVATE_PATH" } });
codex.finish("Done", { status: "completed" });
assert.doesNotMatch(JSON.stringify(codexEvents), /PRIVATE/u);
for (const event of codexEvents) EventSchema.parse(event);

// Browser approval stops remain policy decisions; observation never executes a step.
const browserEvents = [];
let actions = 0;
const deps = {
  now: () => 1, wait: async () => {}, open: async () => {},
  look: async () => ({ url: "https://shop.example/PRIVATE_QUERY", title: "Shop", text: "PRIVATE_PAGE", elements: [{ ref: 1, kind: "button", label: "Pay now" }] }),
  next: async () => ({ step: { action: "click", ref: 1, say: "PRIVATE_REASONING" } }),
  act: async () => { actions++; }, onTaskEvent: (e) => browserEvents.push(e),
};
const browser = await runBrowserTask({ taskId: id, goal: "Find an item", approval: "important" }, deps);
assert.equal(browser.status, "need_approval");
assert.equal(actions, 0);
assert.doesNotMatch(JSON.stringify(browserEvents), /PRIVATE/u);
assert.equal(browserEvents.at(-1).result.status, "need_approval");
for (const event of browserEvents) EventSchema.parse(event);
const abort = new AbortController();
abort.abort();
const abortedEvents = [];
await assert.rejects(runBrowserTask({ taskId: id, goal: "Find an item" }, { ...deps, signal: abort.signal, onTaskEvent: (e) => abortedEvents.push(e) }));
assert.equal(abortedEvents.at(-1).code, "CANCELLED");

// SSE survives arbitrary UTF-8 and CRLF boundaries, and ignores other tasks.
const encoder = new EventEncoder({ accept: "text/event-stream" });
const wrong = { ...events[0], metadata: { vox: { ...events[0].metadata.vox, taskId: randomUUID() } } };
const encoded = new TextEncoder().encode([wrong, ...events, ...events].map((e) => encoder.encode(e).replaceAll("\n", "\r\n")).join(""));
let offset = 0;
const segmented = new Response(new ReadableStream({ pull(controller) {
  if (offset === encoded.length) { controller.close(); return; }
  controller.enqueue(encoded.slice(offset, offset + 1)); offset++;
} }), { headers: { "Content-Type": "text/event-stream" } });
const received = [];
const observed = await readTaskEventResponse(segmented, id, (e) => received.push(e));
assert.equal(observed.answer, "找到 café 🌙");
assert.equal(observed.status, "completed");
assert.equal(received.length, events.length);
assert.equal(await readTaskEventResponse(Response.json({ status: "running" }), id, () => {}), undefined, "old servers fall back to polling");
const oversized = new Response(`data: ${"x".repeat(100_001)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
await assert.rejects(readTaskEventResponse(oversized, id, () => {}), /too large/u);
let reads = 0;
const ready = await readTaskEventResponse(taskEventResponse(id, async () => (++reads === 1 ? { status: "running" } : { status: "done", answer: "Ready", stage: { sources: ["test"] } }), undefined, { intervalMs: 1 }), id, () => {});
assert.equal(ready.answer, "Ready");
assert.deepEqual(ready.result.stage, { sources: ["test"] });
const transient = await readTaskEventResponse(taskEventResponse(id, async () => { throw new Error("network gone"); }), id, () => {});
assert.equal(transient.status, "running", "a transport failure does not fail durable work");
const seen = await readTaskEventResponse(taskEventResponse(id, async () => ({ status: "seen" })), id, () => {});
assert.equal(seen.status, "delivered");
assert.equal(seen.answer, "");
const disconnected = new AbortController();
let finishRead;
const pausedRead = new Promise((resolve) => { finishRead = resolve; });
const suspended = readTaskEventResponse(taskEventResponse(id, () => pausedRead, disconnected.signal), id, () => {});
disconnected.abort();
assert.equal((await suspended).status, "running", "disconnect closes only the subscription");
finishRead({ status: "done", answer: "Still finishes after disconnect" });
const alreadyAborted = new AbortController(); alreadyAborted.abort();
assert.equal(await readTaskEventResponse(taskEventResponse(id, async () => { throw new Error("must not read"); }, alreadyAborted.signal), id, () => {}), undefined);
let cancelledReads = 0;
const cancelledBody = taskEventResponse(id, async () => { cancelledReads++; return { status: "running" }; }, undefined, { intervalMs: 1000 });
await cancelledBody.body.cancel();
await new Promise((resolve) => setTimeout(resolve, 5));
assert.equal(cancelledReads, 1, "body cancellation stops polling");

// Coalesce updates while a write is slow, keep history bounded, and isolate final results.
let release;
let began;
const started = new Promise((resolve) => { began = resolve; });
const blocked = new Promise((resolve) => { release = resolve; });
const writes = [];
const relay = createTaskEventRelay(async (snapshot) => { writes.push(snapshot); began(); await blocked; }, { intervalMs: 1, startAck: { started: true, taskEvents: 1 } });
relay.emit(events[0]);
await started;
for (let i = 0; i < 100; i++) relay.emit({ index: i });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(writes.length, 1, "only one write may be in flight");
assert.equal(relay.events.length, 64);
let closed = false;
const closing = relay.close().then(() => { closed = true; });
await Promise.resolve();
assert.equal(closed, false, "final delivery waits for the in-flight progress write");
release(); await closing;
relay.emit({ index: "late" });
assert.equal(relay.events.at(-1).index, 99);
assert.equal(writes.length, 1, "close discards pending progress, preserving final delivery order");
const snapshots = [];
const coalesced = createTaskEventRelay(async (snapshot) => { snapshots.push(snapshot); }, { intervalMs: 1, startAck: { taskEvents: 1 } });
for (let i = 0; i < 30; i++) coalesced.emit(i);
await new Promise((resolve) => setTimeout(resolve, 10));
await coalesced.close();
assert.deepEqual(snapshots, [Array.from({ length: 12 }, (_, i) => i + 18)]);
for (const startAck of [undefined, { started: true }, { started: true, taskEvents: 2 }]) {
  let legacyWrites = 0;
  const legacy = createTaskEventRelay(async () => { legacyWrites++; }, { intervalMs: 1, startAck });
  legacy.emit(events[0]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await legacy.close();
  assert.equal(legacyWrites, 0, "older servers must never receive a progress PATCH");
  assert.equal(legacy.events.length, 1, "final-result history remains available");
}

const secret = randomBytes(32).toString("base64url");
const deviceId = randomUUID();
const commandId = randomUUID();
const pairing = { deviceId, name: "Test Mac", secret };
const progress = encryptRemoteTaskProgress(secret, deviceId, commandId, events);
assert.deepEqual(await decryptRemoteTaskProgress(pairing, commandId, progress.ciphertext, progress.iv), events);
await assert.rejects(decryptRemoteResult(pairing, commandId, progress.ciphertext, progress.iv), "progress cannot masquerade as a result");
await assert.rejects(decryptRemoteTaskProgress(pairing, randomUUID(), progress.ciphertext, progress.iv));
await assert.rejects(decryptRemoteTaskProgress({ ...pairing, deviceId: randomUUID() }, commandId, progress.ciphertext, progress.iv));
const final = encryptRemoteResult(secret, deviceId, commandId, { ok: true, answer: "Done", events });
assert.deepEqual((await decryptRemoteResult(pairing, commandId, final.ciphertext, final.iv)).events, events);
await assert.rejects(decryptRemoteTaskProgress(pairing, commandId, final.ciphertext, final.iv));

console.log("Task events: schema, lifecycle, isolation, SSE recovery, browser approvals, coalescing, and encrypted relay checks passed.");
