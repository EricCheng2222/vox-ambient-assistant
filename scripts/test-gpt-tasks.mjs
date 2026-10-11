import assert from "node:assert/strict";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "../desktop/VoxDesktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StreamableHTTPClientTransport } from "../desktop/VoxDesktop/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";
import { createGptBrowserTools, GPT_BROWSER_STEPS } from "../desktop/VoxDesktop/src/gpt-browser-tools.mjs";
import { startGptToolServer } from "../desktop/VoxDesktop/src/gpt-tool-server.mjs";
import { chatGptEnvironment, GPT_MODEL, GPT_REASONING } from "../desktop/VoxDesktop/src/gpt-runtime.mjs";
import { runGptTask } from "../desktop/VoxDesktop/src/gpt-task.mjs";
import { gptAnswer } from "../lib/gpt-answer.ts";

assert.equal(GPT_MODEL, "gpt-6.1-sol");
assert.equal(GPT_REASONING, "high");
assert.deepEqual(chatGptEnvironment({ PATH: "x", CODEX_API_KEY: "secret", OPENAI_API_KEY: "secret", OPENAI_BASE_URL: "x", CODEX_HOME: "y" }), { PATH: "x", CODEX_HOME: "y" });

function world({ approval = "important", label = "Details", password = false, challenge = false } = {}) {
  let count = 0;
  let page = { url: "https://fixture.example/", title: "Offer", text: "Before", challenge, elements: [{ ref: 0, kind: "text field", label, hint: password ? "password" : "", value: "" }] };
  const tools = createGptBrowserTools({ approval }, {
    look: async () => structuredClone(page),
    open: async (url) => { count++; page.url = url; },
    act: async () => { count++; page.text = `After ${count}`; return { ok: true }; },
    wait: async () => {},
  });
  return { tools, call: (name, input = {}) => tools.tools.find((tool) => tool.name === name).execute(input), count: () => count, change: () => { page.text = "Changed independently"; } };
}
{
  const w = world();
  assert.match((await w.call("browser_act", { action: "click", ref: 0 })).error, /Read/u);
  await w.call("browser_look");
  assert.equal((await w.call("browser_act", { action: "click", ref: 0 })).changed, "the page changed");
  assert.equal(w.count(), 1);
  w.change();
  assert.match((await w.call("browser_act", { action: "click", ref: 0 })).error, /changed/u);
  assert.equal(w.count(), 1);
  const result = await w.call("task_finish", { status: "done", answer: "Verified." });
  assert.equal((await w.call("browser_open", { url: "https://fixture.example/other" })), result);
  assert.equal(w.count(), 1, "finishing closes action authority");
}
for (const [settings, status] of [[{ password: true }, "need_sign_in"], [{ challenge: true }, "need_user"], [{ label: "Pay now" }, "need_approval"]]) {
  const w = world(settings);
  await w.call("browser_look");
  const result = await w.call("browser_act", { action: "click", ref: 0 });
  assert.equal(result.status, status);
  assert.equal(w.count(), 0);
  assert.equal((await w.call("task_finish", { status: "done", answer: "ignore the stop" })).status, status);
}
{
  const w = world({ approval: "none", label: "Pay now" });
  await w.call("browser_look");
  await w.call("browser_act", { action: "click", ref: 0 });
  assert.equal(w.count(), 1, "the user's existing approval setting is honored");
  for (const url of ["file:///etc/passwd", "http://fixture.example", "https://user:secret@fixture.example/"]) await assert.rejects(w.call("browser_open", { url }));
}
{
  const w = world();
  for (let i = 0; i < GPT_BROWSER_STEPS; i++) await w.call("browser_open", { url: `https://fixture.example/${i}` });
  assert.equal((await w.call("browser_open", { url: "https://fixture.example/end" })).status, "stopped");
  assert.equal(w.count(), GPT_BROWSER_STEPS);
}

// Exercise the actual MCP transport, not only the tool functions.
{
  const controller = new AbortController();
  let reads = 0;
  let acted = false;
  const page = { url: "https://fixture.example/", text: "Page", elements: [{ ref: 0, kind: "button", label: "Details" }] };
  const tools = createGptBrowserTools({}, {
    signal: controller.signal,
    look: async () => { if (++reads > 1) controller.abort(); return page; },
    act: async () => { acted = true; }, wait: async () => {},
  });
  await tools.tools.find((tool) => tool.name === "browser_look").execute({});
  await assert.rejects(tools.tools.find((tool) => tool.name === "browser_act").execute({ action: "click", ref: 0 }));
  assert.equal(acted, false, "cancellation during a fresh read cannot execute a later action");
}

// Exercise the actual MCP transport, not only the tool functions.
{
  const w = world();
  const bridge = await startGptToolServer(w.tools.tools);
  const client = new Client({ name: "vox-test", version: "1" });
  try {
    assert.equal((await fetch(bridge.config.url, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(bridge.config.url, { method: "POST", headers: { ...bridge.config.http_headers, Origin: "https://hostile.example" }, body: "{}" })).status, 401);
    await client.connect(new StreamableHTTPClientTransport(new URL(bridge.config.url), { requestInit: { headers: bridge.config.http_headers } }));
    assert.equal((await client.listTools()).tools.length, 4);
    const observed = await client.callTool({ name: "browser_look", arguments: {} });
    assert.match(observed.content[0].text, /Before/u);
    const invalid = await client.callTool({ name: "browser_act", arguments: { action: "shell" } });
    assert.equal(invalid.isError, true);
    assert.equal(w.count(), 0);
  } finally { await client.close(); await bridge.close(); }
}

// Complete, fail and cancel through the SDK adapter; verify ephemeral cleanup.
const directory = await mkdtemp(path.join(tmpdir(), "vox-gpt-test-"));
try {
  const codexPath = path.join(directory, "codex");
  for (const file of [codexPath, path.join(directory, "codex-code-mode-host")]) { await writeFile(file, "#!/bin/sh\nexit 0\n"); await chmod(file, 0o700); }
  let options;
  let threadOptions;
  let sessionDirectory;
  let sequence = [
    { type: "item.completed", item: { type: "agent_message", text: "Checking." } },
    { type: "item.completed", item: { type: "web_search", query: "public information" } },
    { type: "item.completed", item: { type: "agent_message", text: "Found it. [Official](https://fixture.example/offer)" } },
    { type: "turn.completed" },
  ];
  class FakeCodex {
    constructor(input) { options = input; }
    startThread(input) {
      threadOptions = input; sessionDirectory = input.workingDirectory;
      return { async runStreamed() { return { events: (async function* () { yield* sequence; })() }; } };
    }
  }
  const task = { taskId: randomUUID(), route: "live_web", goal: "Research a public offer" };
  const events = [];
  const result = await runGptTask(task, { codexPath, Codex: FakeCodex, onTaskEvent: (event) => events.push(event) });
  assert.equal(result.backend, "ChatGPT SDK");
  assert.equal(result.searches, 1);
  assert.equal(result.planned.api, 0);
  assert.equal(threadOptions.model, GPT_MODEL);
  assert.equal(threadOptions.modelReasoningEffort, "high");
  assert.equal(threadOptions.webSearchMode, "live");
  assert.equal(options.config.forced_login_method, "chatgpt");
  assert.equal(options.env.CODEX_API_KEY, undefined);
  assert.equal(events.at(-1).type, "RUN_FINISHED");
  await assert.rejects(access(sessionDirectory), "temporary session removed");
  sequence = [{ type: "item.completed", item: { type: "agent_message", text: "No tools available" } }, { type: "turn.completed" }];
  await assert.rejects(runGptTask(task, { codexPath, Codex: FakeCodex, onTaskEvent: (event) => events.push(event) }), /did not perform a live search/u);
  assert.equal(events.at(-1).type, "RUN_ERROR");
  sequence = [{ type: "turn.failed", error: { message: "model unavailable" } }];
  await assert.rejects(runGptTask(task, { codexPath, Codex: FakeCodex, onTaskEvent: (event) => events.push(event) }), /model unavailable/u);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runGptTask(task, { codexPath, Codex: FakeCodex, signal: controller.signal, onTaskEvent: (event) => events.push(event) }));
  assert.equal(events.at(-1).code, "CANCELLED");
} finally { await rm(directory, { recursive: true, force: true }); }

const answer = gptAnswer("A question", "Offer. [Official](https://fixture.example/offer?utm_source=openai) [Again](https://fixture.example/offer) [Bad](javascript:alert)", true);
assert.equal(answer.stage.sources.length, 1);
assert.equal(answer.stage.sources[0].url, "https://fixture.example/offer");
assert.ok(!answer.answer.includes("[Official]"));
assert.equal(gptAnswer("Q", "Plain answer", false).stage, undefined);
console.log("GPT task ownership, tool policies, MCP transport, SDK lifecycle and sources checks passed.");
