import { requireUser } from "@/lib/auth";
import { taskStepFromReply, taskStepInput, TASK_STEP_INSTRUCTIONS, TASK_STEP_SCHEMA } from "@/lib/browser-task";

// The next step of a website task the user's Mac is carrying out by itself
// (see lib/browser-task.ts and desktop/VoxDesktop/src/browser-task.mjs). The
// Mac sends the goal, what it has done, and the page as it looks now; this
// answers with one step. The Mac enforces its own limits on what it will do.
//
// A Mac that can think for itself (the Codex runtime under the user's own
// ChatGPT sign-in, desktop/VoxDesktop/src/local-planner.mjs) asks only for the
// question ("prepare") and has its answer checked ("check"): no model is
// called here for either, so those steps cost nothing on the API.

const noStore = { "Cache-Control": "no-store" };
// The model for steps chosen here. Set BROWSER_STEP_MODEL to change it.
const STEP_MODEL = process.env.BROWSER_STEP_MODEL?.trim() || "gpt-5.6-terra";

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { mode?: unknown; raw?: unknown; goal?: unknown; look?: unknown; history?: unknown; language?: unknown; context?: unknown; stepsLeft?: unknown; final?: unknown };
  if (body.mode === "check") {
    const step = taskStepFromReply(body.raw);
    if (!step) return Response.json({ error: "The next step was not usable." }, { status: 422, headers: noStore });
    return Response.json({ step }, { headers: noStore });
  }
  if (typeof body.goal !== "string" || body.goal.trim().length < 4) return Response.json({ error: "What is the task?" }, { status: 400, headers: noStore });
  const input = taskStepInput(body);
  if (body.mode === "prepare") {
    return Response.json({ instructions: TASK_STEP_INSTRUCTIONS, input, schema: TASK_STEP_SCHEMA }, { headers: noStore });
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Not configured." }, { status: 503, headers: noStore });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model: STEP_MODEL,
      instructions: TASK_STEP_INSTRUCTIONS,
      input,
      reasoning: { effort: "low" },
      max_output_tokens: 1_600,
      text: { format: { type: "json_schema", name: "next_step", strict: true, schema: TASK_STEP_SCHEMA } },
      store: false,
    }),
  }).catch(() => null);
  if (!response?.ok) {
    await response?.body?.cancel();
    console.error("Browser task step failed", response?.status ?? "unreachable");
    return Response.json({ error: "The next step could not be worked out." }, { status: 502, headers: noStore });
  }
  const payload = (await response.json().catch(() => ({}))) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const raw = payload.output_text ?? (payload.output ?? []).flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text").map((item) => item.text ?? "").join("");
  const step = taskStepFromReply(raw);
  if (!step) return Response.json({ error: "The next step was not usable." }, { status: 502, headers: noStore });
  // Token counts go back with the step so the cost of a task can be seen.
  return Response.json({ step, usage: { input: payload.usage?.input_tokens ?? 0, output: payload.usage?.output_tokens ?? 0 } }, { headers: noStore });
}
