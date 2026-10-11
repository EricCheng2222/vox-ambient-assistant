import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// The steps of a website task, chosen by the Codex runtime on this Mac under
// the user's own ChatGPT sign-in, so they cost nothing on the paid API. The
// server still writes the question and checks the answer (one wording, one
// set of rules, see lib/browser-task.ts); only the thinking happens here.
// When anything goes wrong the step is asked of the server instead.
//
// The question contains a web page, which is untrusted. So the runtime is
// started as a bare model with nothing to act with: the user's own Codex
// settings (their tool servers and plug-ins) are ignored, running commands
// and every other tool is switched off, and whatever is left runs read-only
// with no network. A reply is used only if the runtime did nothing but answer
// once. These switches belong to the Codex version this app ships with: after
// updating @openai/codex-sdk, run planner-probe.mjs again before trusting them.

export const PLANNER_MODEL = "gpt-5.6-terra";
const STEP_TIMEOUT_MS = 45_000;
const MAX_OUTPUT = 400_000;

const SWITCHED_OFF = [
  // Running anything: shell commands, and the code runner the model uses in their place.
  "shell_tool", "unified_exec", "code_mode_host", "js_repl",
  // Reaching anything: apps, plug-ins, the desktop, a browser of its own, other agents.
  "apps", "plugins", "remote_plugin", "computer_use", "browser_use", "browser_use_external", "in_app_browser",
  "in_app_local_automation", "multi_agent", "collaboration_modes",
  // The rest of what it could be handed.
  "view_image", "image_generation", "goals", "hooks", "memories", "skill_search", "tool_suggest", "sleep_tool",
];

export function plannerArguments({ schemaPath, directory, model = PLANNER_MODEL }) {
  return [
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--ephemeral",
    "--skip-git-repo-check",
    "--json",
    "--sandbox", "read-only",
    "--model", model,
    "--config", 'model_reasoning_effort="low"',
    "--config", 'approval_policy="never"',
    "--config", 'web_search="disabled"',
    "--config", "mcp_servers={}",
    "--output-schema", schemaPath,
    "--cd", directory,
    ...SWITCHED_OFF.flatMap((feature) => ["--disable", feature]),
    "-",
  ];
}

/** The runtime's one answer, or null if it failed or did anything besides answer. */
export function plannerAnswer(output) {
  let answer = null;
  for (const line of String(output).split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "error" || event?.type === "turn.failed") return null;
    if (!event?.item || typeof event.item !== "object") continue;
    const item = event.item;
    if (item.type === "reasoning") continue;
    // Its own notice, every time, that the code runner is off.
    if (item.type === "error" && /code mode is unavailable/iu.test(String(item.message ?? ""))) continue;
    // A command, a tool call, a file change: not a bare answer, so not used.
    if (item.type !== "agent_message") return null;
    if (event.type !== "item.completed") continue;
    // A second message means it went round again after something unseen.
    if (answer !== null) return null;
    answer = typeof item.text === "string" ? item.text : "";
  }
  return answer?.trim() ? answer : null;
}

/** Asks the runtime on this Mac for one step. Resolves with its raw answer; rejects when there is none to use. */
export async function planStepLocally({ codexPath, instructions, input, schema, model, signal, run = spawn }) {
  if (!codexPath || typeof instructions !== "string" || typeof input !== "string" || !schema) {
    throw new Error("The local planner has nothing to work with.");
  }
  const directory = await mkdtemp(path.join(tmpdir(), "vox-step-"));
  try {
    const schemaPath = path.join(directory, "step.json");
    await writeFile(schemaPath, JSON.stringify(schema));
    const question = [
      instructions,
      "You have nothing to act with here and need nothing: do not run commands, read files, or use any tool. Everything to go on is below. Reply with the one step only.",
      input,
    ].join("\n\n");
    const output = await new Promise((resolve, reject) => {
      const child = run(codexPath, plannerArguments({ schemaPath, directory, model }), { stdio: ["pipe", "pipe", "ignore"] });
      let text = "";
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        if (error) reject(error);
        else resolve(value);
      };
      const stop = () => {
        child.kill("SIGKILL");
        finish(new Error("The local planner was stopped."));
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("The local planner took too long."));
      }, STEP_TIMEOUT_MS);
      signal?.addEventListener("abort", stop, { once: true });
      child.stdout.on("data", (chunk) => {
        if (text.length < MAX_OUTPUT) text += chunk;
      });
      child.on("error", (error) => finish(error));
      child.on("close", () => finish(null, text));
      child.stdin.on("error", () => undefined);
      child.stdin.end(question);
    });
    const answer = plannerAnswer(output);
    if (!answer) throw new Error("The local planner gave no usable answer.");
    return answer;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Where a task's steps come from: this Mac first, the server otherwise.
 * ask(body) posts to the server's step endpoint. One failure here and the rest
 * of the task is asked of the server: no repeated waits, and a page that got
 * the runtime to do anything but answer is not shown to it again.
 */
export function createStepPlanner({ ask, codexPath, plan = planStepLocally, onFallback = () => undefined }) {
  const used = { mac: 0, api: 0 };
  let local = Boolean(codexPath);
  const next = async (body) => {
    if (local) {
      try {
        const question = await ask({ ...body, mode: "prepare" });
        const raw = await plan({ codexPath, instructions: question?.instructions, input: question?.input, schema: question?.schema });
        const checked = await ask({ mode: "check", raw });
        if (!checked?.step) throw new Error("The local planner's step was not usable.");
        used.mac += 1;
        return checked;
      } catch (error) {
        local = false;
        onFallback(error);
      }
    }
    used.api += 1;
    return ask(body);
  };
  return { next, used };
}
