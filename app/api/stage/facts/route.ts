import { requireUser } from "@/lib/auth";
import { selectResponseLanguage } from "@/lib/response-language";
import { sanitizeStage, STAGE_INSTRUCTIONS, STAGE_SCHEMA } from "@/lib/stage-answer";

// A few facts pulled out of a spoken web answer for the stage (key dates,
// numbers, steps). The page asks for them while Vox is already speaking, so
// the answer never waits on this.

const STAGE_TIMEOUT_MS = 8_000;

function readOutputText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}) {
  if (payload.output_text) return payload.output_text;
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "Not configured." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    question?: unknown;
    answer?: unknown;
    sources?: unknown;
  };
  const question = typeof body.question === "string" ? body.question.trim().slice(0, 2000) : "";
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 8000) : "";
  const sourceTitles = (Array.isArray(body.sources) ? body.sources : [])
    .map((source) => (source && typeof source === "object" ? source as { title?: unknown; site?: unknown } : {}))
    .map((source) => [source.title, source.site].filter((value) => typeof value === "string").join(" ("))
    .filter(Boolean)
    .slice(0, 5);
  if (!answer) return Response.json({ error: "An answer is required." }, { status: 400 });
  // Stated outright: left to infer it, the model sometimes switches language.
  const language =
    selectResponseLanguage(answer) === "taiwan_mandarin"
      ? "Write the title, every label, and every value in Traditional Chinese as used in Taiwan."
      : "Write the title, every label, and every value in English.";

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(STAGE_TIMEOUT_MS),
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        instructions: `${STAGE_INSTRUCTIONS} ${language}`,
        input:
          `Question:\n${question}\n\nAnswer:\n${answer}` +
          (sourceTitles.length ? `\n\nCited pages:\n${sourceTitles.map((title) => `- ${title}`).join("\n")}` : ""),
        reasoning: { effort: "low" },
        max_output_tokens: 1200,
        store: false,
        text: {
          verbosity: "low",
          format: { type: "json_schema", name: "stage", strict: true, schema: STAGE_SCHEMA },
        },
      }),
    });
    const payload = (await response.json()) as Parameters<typeof readOutputText>[0];
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const parsed = sanitizeStage(JSON.parse(readOutputText(payload)));
    return Response.json(parsed, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Stage facts failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ title: "", blocks: [] }, { headers: { "Cache-Control": "no-store" } });
  }
}
