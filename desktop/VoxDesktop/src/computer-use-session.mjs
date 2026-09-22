import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export function computerUseFailure(item) {
  const details = JSON.stringify({ error: item.error, result: item.result });
  if (/declined TCCs|SCStreamErrorDomain[^\n]*-3801/i.test(details)) {
    return "macOS blocked screen capture for Computer Use. In System Settings → Privacy & Security → Screen & System Audio Recording, enable the Computer Use helper, then quit and reopen that helper and retry. The task was not completed.";
  }
  return null;
}

// Only satisfy the app-access request covered by this task's spoken confirmation.
// Never grant persistent access, shell access, or access to another app.
export function permitsConfirmedApp(params, bundleId, threadId) {
  const meta = params?._meta;
  return params?.threadId === threadId &&
    params?.serverName === "cua_repl" && params?.mode === "form" &&
    meta?.connector_id === "computer-use" &&
    new Set(["get_app_state", "get_app_screenshot", "click", "press_key", "type_text", "paste", "scroll", "drag", "select_text", "set_value", "perform_secondary_action"]).has(meta?.tool_name) &&
    meta?.tool_params?.app === bundleId &&
    params?.requestedSchema?.type === "object" &&
    Object.keys(params.requestedSchema.properties ?? {}).length === 0;
}

export function computerUseModelSettings(mode) {
  return mode === "fast"
    ? { model: "gpt-5.6-luna", effort: "low" }
    : { model: "gpt-5.6-terra", effort: "medium" };
}

export async function runComputerUseSession({ executable, cwd, prompt, bundleId, mode, signal, onItem, onDiagnostic = () => {}, completionCheck, completionAnswer = "" }) {
  const settings = computerUseModelSettings(mode);
  const child = spawn(executable, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 0;
  let threadId;
  let answer = "";
  let finished = false;
  let stalledTool;
  let completionCheckRunning = false;
  let resolveTurn;
  let rejectTurn;
  const completed = new Promise((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
  // Attach immediately: a startup failure can precede awaiting the turn.
  completed.catch(() => {});
  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    send({ id, method, params });
  });
  const fail = (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(stalledTool);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    rejectTurn(error);
    child.kill();
  };
  const abort = () => { fail(new Error("Computer Use task cancelled.")); child.kill(); };
  const completeIfSatisfied = async () => {
    if (finished || completionCheckRunning || typeof completionCheck !== "function") return;
    completionCheckRunning = true;
    try {
      if (await completionCheck()) {
        finished = true;
        clearTimeout(stalledTool);
        resolveTurn(completionAnswer || answer);
        child.kill();
      }
    } catch {
      // A failed completion probe must not turn a usable Computer Use task into a false failure.
    } finally {
      completionCheckRunning = false;
    }
  };
  const timeout = setTimeout(() => { fail(new Error("Computer Use task timed out.")); child.kill(); }, 180_000);
  child.stderr.resume();
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.on("exit", () => { if (!finished) fail(new Error("Local Computer Use process ended before completing the task.")); });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    onDiagnostic(message);
    if (message.method && message.id !== undefined) {
      if (message.method === "mcpServer/elicitation/request") {
        send({ id: message.id, result: permitsConfirmedApp(message.params, bundleId, threadId)
          ? { action: "accept", content: {} }
          : { action: "decline", content: null } });
      } else {
        send({ id: message.id, error: { code: -32603, message: "This request is outside the confirmed app-access scope." } });
      }
      return;
    }
    if (message.id !== undefined) {
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      }
      return;
    }
    if (message.params?.threadId !== threadId) return;
    if (message.method === "item/started" && message.params.item.type === "mcpToolCall") {
      const item = message.params.item;
      onItem({ ...item, type: "mcp_tool_call" });
      clearTimeout(stalledTool);
      stalledTool = setTimeout(() => fail(new Error("The local Computer Use tool stopped responding. The requested action could not be verified. Check the Computer Use helper and its macOS Screen Recording permission before retrying.")), 60_000);
    }
    if (message.method === "item/completed") {
      const item = message.params.item;
      if (item.type === "agentMessage") {
        if (item.phase !== "commentary") answer = item.text;
        onItem({ type: "agent_message", text: item.text });
      } else if (item.type === "mcpToolCall") {
        clearTimeout(stalledTool);
        onItem({ ...item, type: "mcp_tool_call" });
        const failure = computerUseFailure(item);
        if (failure) fail(new Error(failure));
        else void completeIfSatisfied();
      }
    }
    if (message.method === "turn/completed") {
      if (finished) return;
      finished = true;
      const turn = message.params.turn;
      if (turn.status === "completed") resolveTurn(answer);
      else rejectTurn(new Error(turn.error?.message ?? `Computer Use task ${turn.status}.`));
    }
  });
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new Error("Computer Use task cancelled.");
    await request("initialize", {
      clientInfo: { name: "vox_desktop", version: "0.1.3" },
      capabilities: { experimentalApi: true },
    });
    send({ method: "initialized", params: {} });
    const started = await request("thread/start", {
      cwd, ephemeral: true, approvalPolicy: "on-request", sandbox: "read-only",
      model: settings.model,
      config: { web_search: "disabled", model_reasoning_effort: settings.effort },
    });
    threadId = started.thread.id;
    onItem({ type: "agent_message", text: `Computer Use: ${settings.model} · ${settings.effort}` });
    await request("turn/start", { threadId, ...settings, input: [{ type: "text", text: prompt }] });
    return await completed;
  } finally {
    finished = true;
    clearTimeout(timeout);
    clearTimeout(stalledTool);
    signal.removeEventListener("abort", abort);
    lines.close();
    child.kill();
  }
}
