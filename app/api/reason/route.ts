import { requireUser } from "@/lib/auth";
import { formatMemoryContext } from "@/lib/memory";
import { listMemories } from "@/lib/memory-store";
import { getCurrentTimeContext } from "@/lib/time-context";

type ReasonRoute = "balanced_reasoning" | "expert_reasoning" | "live_web";

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
  if (!apiKey) {
    return Response.json({ error: "OpenAI is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    route?: ReasonRoute;
  };
  const text = body.text?.trim().slice(0, 12000) ?? "";
  const route = body.route;
  if (!text || !route) {
    return Response.json({ error: "A prompt and route are required." }, { status: 400 });
  }

  const isExpert = route === "expert_reasoning";
  const isWeb = route === "live_web";
  const model = isExpert ? "gpt-6-astra" : "gpt-5.6-terra";
  const remembered = await listMemories(auth.user.id, 24).catch((error) => {
    console.error("Reasoning without saved memory", error);
    return [];
  });
  const memoryContext = remembered.length ? `\n\n${formatMemoryContext(remembered)}` : "";
  const timeContext = `\n\n${getCurrentTimeContext()}`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      instructions:
        "Prepare a concise, accurate answer for a voice assistant to speak aloud. Match the language of the user's substantive request. For Mandarin or Chinese input, answer in natural Taiwan Mandarin using Traditional Chinese, Taiwan vocabulary and phrasing, and no Mainland-specific wording. For English input, answer in English. Use plain language, short sentences, and no markdown. Do not mention model routing." +
        timeContext +
        memoryContext,
      reasoning: { effort: isExpert ? "high" : "low" },
      text: { verbosity: "low" },
      max_output_tokens: isExpert ? 1800 : 1000,
      tools: isWeb ? [{ type: "web_search" }] : undefined,
      store: false,
    }),
  });

  const payload = (await response.json()) as Parameters<typeof readOutputText>[0];
  if (!response.ok) {
    console.error("Reasoning request failed", response.status);
    return Response.json(
      { error: "The selected reasoning model could not answer." },
      { status: response.status },
    );
  }

  const answer = readOutputText(payload);
  return Response.json({ answer, model }, { headers: { "Cache-Control": "no-store" } });
}
