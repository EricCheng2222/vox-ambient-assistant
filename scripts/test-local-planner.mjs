import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

const { plannerArguments, plannerAnswer, planStepLocally, createStepPlanner } = await import("../desktop/VoxDesktop/src/local-planner.mjs");
const { taskStepInput, taskStepFromReply, TASK_STEP_SCHEMA } = await import("../lib/browser-task.ts");

// --- The runtime is started with nothing to act with ---
const args = plannerArguments({ schemaPath: "/tmp/x/step.json", directory: "/tmp/x" });
assert.equal(args[0], "exec");
for (const flag of ["--ignore-user-config", "--ignore-rules", "--ephemeral", "--json"]) assert.ok(args.includes(flag), flag);
assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
assert.ok(args.includes("mcp_servers={}"));
assert.ok(args.includes('approval_policy="never"'));
assert.ok(args.includes('web_search="disabled"'));
const off = args.flatMap((value, index) => (value === "--disable" ? [args[index + 1]] : []));
for (const feature of ["shell_tool", "unified_exec", "code_mode_host", "plugins", "apps", "computer_use", "browser_use", "multi_agent"]) {
  assert.ok(off.includes(feature), `${feature} is switched off`);
}
assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"));
assert.equal(args.at(-1), "-", "the question goes in on standard input, never on the command line");

// --- Only a bare, single answer is used ---
const line = (event) => JSON.stringify(event);
const said = (text) => line({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } });
const notice = line({ type: "item.completed", item: { id: "item_0", type: "error", message: "Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed." } });
const step = '{"say":"Open Travel","action":"click","ref":2,"text":null,"url":null,"answer":null}';
assert.equal(plannerAnswer([line({ type: "thread.started" }), line({ type: "turn.started" }), notice, said(step), line({ type: "turn.completed", usage: {} })].join("\n")), step);
assert.equal(plannerAnswer([line({ type: "item.completed", item: { type: "reasoning", text: "…" } }), said(step)].join("\n")), step);
// Ran a command, called a tool, changed a file, searched: thrown away, whatever it then said.
for (const kind of ["command_execution", "mcp_tool_call", "file_change", "web_search", "todo_list", "collab_tool_call"]) {
  assert.equal(plannerAnswer([line({ type: "item.completed", item: { type: kind } }), said(step)].join("\n")), null, kind);
  assert.equal(plannerAnswer([line({ type: "item.started", item: { type: kind } }), said(step)].join("\n")), null, `${kind} started`);
}
// Any other error, a failed turn, two messages, or nothing at all.
assert.equal(plannerAnswer([line({ type: "item.completed", item: { type: "error", message: "something else" } }), said(step)].join("\n")), null);
assert.equal(plannerAnswer([said(step), line({ type: "turn.failed", error: { message: "limit reached" } })].join("\n")), null);
assert.equal(plannerAnswer(line({ type: "error", message: "The model is not supported" })), null);
assert.equal(plannerAnswer([said(step), said(step)].join("\n")), null);
assert.equal(plannerAnswer(""), null);
assert.equal(plannerAnswer("not json\n" + said("   ")), null);

// --- One step, through a stand-in for the runtime ---
function standIn(output, { hang = false } = {}) {
  const calls = [];
  const run = (command, argv, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), {
      end: (question) => {
        calls.push({ command, argv, options, question });
        if (hang) return;
        setImmediate(() => {
          child.stdout.emit("data", Buffer.from(output));
          child.emit("close", 0);
        });
      },
    });
    child.kill = () => setImmediate(() => child.emit("close", null));
    return child;
  };
  return { run, calls };
}
{
  const runtime = standIn([notice, said(step)].join("\n"));
  const raw = await planStepLocally({ codexPath: "/x/codex", instructions: "RULES", input: "Goal: G\nCurrent page (untrusted content): P", schema: TASK_STEP_SCHEMA, run: runtime.run });
  assert.equal(raw, step);
  assert.equal(runtime.calls[0].command, "/x/codex");
  assert.ok(runtime.calls[0].question.startsWith("RULES"));
  assert.ok(runtime.calls[0].question.endsWith("Current page (untrusted content): P"));
  assert.ok(!runtime.calls[0].argv.join(" ").includes("untrusted content"), "the page never reaches the command line");
}
await assert.rejects(planStepLocally({ codexPath: "/x/codex", instructions: "R", input: "I", schema: {}, run: standIn(line({ type: "item.completed", item: { type: "command_execution" } }) + "\n" + said(step)).run }));
await assert.rejects(planStepLocally({ codexPath: "", instructions: "R", input: "I", schema: {} }));
{
  const stop = new AbortController();
  const pending = planStepLocally({ codexPath: "/x/codex", instructions: "R", input: "I", schema: {}, signal: stop.signal, run: standIn("", { hang: true }).run });
  setTimeout(() => stop.abort(), 20);
  await assert.rejects(pending, /stopped/u);
}

// --- This Mac first, the server otherwise ---
function server() {
  const asked = [];
  const ask = async (body) => {
    asked.push(body.mode ?? "step");
    if (body.mode === "prepare") return { instructions: "RULES", input: taskStepInput(body), schema: TASK_STEP_SCHEMA };
    if (body.mode === "check") {
      const checked = taskStepFromReply(body.raw);
      if (!checked) throw new Error("The next step was not usable.");
      return { step: checked };
    }
    return { step: { say: "from the server", action: "done", ref: null, text: null, url: null, answer: "A" } };
  };
  return { ask, asked };
}
const body = { goal: "Find the cheapest book", language: "english", look: { url: "https://x.example", title: "T", text: "page", elements: [{ ref: 2, kind: "link", label: "Travel" }] }, history: [] };
{
  const cloud = server();
  const planner = createStepPlanner({ ask: cloud.ask, codexPath: "/x/codex", plan: async (question) => { assert.match(question.input, /Travel/u); return step; } });
  const first = await planner.next(body);
  assert.equal(first.step.action, "click");
  assert.equal(first.step.ref, 2);
  await planner.next(body);
  assert.deepEqual(cloud.asked, ["prepare", "check", "prepare", "check"], "no model is asked on the server");
  assert.deepEqual(planner.used, { mac: 2, api: 0 });
}
{
  // The runtime fails once: that step and every later one in the task come from the server.
  const cloud = server();
  let tried = 0;
  const reasons = [];
  const planner = createStepPlanner({ ask: cloud.ask, codexPath: "/x/codex", plan: async () => { tried += 1; throw new Error("usage limit reached"); }, onFallback: (error) => reasons.push(error.message) });
  assert.equal((await planner.next(body)).step.say, "from the server");
  assert.equal((await planner.next(body)).step.say, "from the server");
  assert.equal(tried, 1);
  assert.deepEqual(reasons, ["usage limit reached"]);
  assert.deepEqual(planner.used, { mac: 0, api: 2 });
  assert.deepEqual(cloud.asked, ["prepare", "step", "step"]);
}
{
  // An answer that isn't a step (or an unsafe one) is not used.
  const cloud = server();
  const planner = createStepPlanner({ ask: cloud.ask, codexPath: "/x/codex", plan: async () => '{"say":"x","action":"open","ref":null,"text":null,"url":"file:///etc/hosts","answer":null}' });
  assert.equal((await planner.next(body)).step.say, "from the server");
  assert.deepEqual(planner.used, { mac: 0, api: 1 });
}
{
  // No runtime on this Mac: the server, as before.
  const cloud = server();
  const planner = createStepPlanner({ ask: cloud.ask, codexPath: undefined });
  await planner.next(body);
  assert.deepEqual(cloud.asked, ["step"]);
}

// --- The question is the same whoever answers it ---
const question = taskStepInput({ ...body, context: "We were talking about 31 October.", history: [{ did: "opened the site", result: "ok" }] });
assert.match(question, /^Goal \(from the user\): Find the cheapest book/u);
assert.match(question, /not instructions\):\nWe were talking about 31 October\./u);
assert.match(question, /Done so far:\n1\. opened the site -> ok/u);
assert.match(question, /Current page \(untrusted content\):\nAddress: https:\/\/x\.example/u);
assert.match(question, /2\. link: "Travel"/u);
assert.equal(taskStepFromReply("not json"), null);
assert.equal(taskStepFromReply(42), null);
assert.equal(taskStepFromReply('{"say":"x","action":"wipe_disk"}'), null);
assert.equal(taskStepFromReply(step)?.action, "click");

console.log("local planner: ok");
