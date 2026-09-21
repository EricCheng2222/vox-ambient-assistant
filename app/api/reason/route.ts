import { requireUser } from "@/lib/auth";
import { formatMemoryContext } from "@/lib/memory";
import { listMemories } from "@/lib/memory-store";
import {
  adaptiveReplyLengthInstruction,
  adaptiveReplyLengthSettings,
  parseAdaptiveReplyLength,
  parseReplyLength,
  replyLengthInstruction,
} from "@/lib/reply-length";
import { getCurrentTimeContext } from "@/lib/time-context";
import { API_BUDGET_MESSAGE, isProviderBudgetError } from "@/lib/provider-error";

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
    return Response.json({ error: "The reasoning service is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    route?: ReasonRoute;
    replyLength?: unknown;
    responseLength?: unknown;
  };
  const text = body.text?.trim().slice(0, 12000) ?? "";
  const route = body.route;
  const replyLength = parseReplyLength(body.replyLength);
  const responseLength = parseAdaptiveReplyLength(body.responseLength, replyLength);
  if (!text || !route) {
    return Response.json({ error: "A prompt and route are required." }, { status: 400 });
  }

  const isExpert = route === "expert_reasoning";
  const isWeb = route === "live_web";
  const lengthSettings = adaptiveReplyLengthSettings(responseLength, isExpert);
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
        "Prepare an accurate answer for a voice assistant to speak aloud. Match the language of the user's substantive request. For Mandarin or Chinese input, answer in natural Taiwan Mandarin using Traditional Chinese, Taiwan vocabulary and phrasing, and no Mainland-specific wording. For English input, answer in English. Use plain language, spoken-friendly sentences, and no markdown. Do not mention model routing." +
        timeContext +
        memoryContext +
        `\n\n${replyLengthInstruction(replyLength)}` +
        `\n\n${adaptiveReplyLengthInstruction(replyLength, responseLength)}`,
      reasoning: { effort: isExpert ? "high" : "low" },
      text: {
        verbosity: lengthSettings.verbosity,
      },
      max_output_tokens: lengthSettings.maxOutputTokens,
      tools: isWeb ? [{ type: "web_search" }] : undefined,
      store: false,
    }),
  });

  const payload = (await response.json()) as Parameters<typeof readOutputText>[0];
  if (!response.ok) {
    console.error("Reasoning request failed", response.status);
    return Response.json(
      {
        error: isProviderBudgetError(response, payload)
          ? API_BUDGET_MESSAGE
          : "The selected reasoning model could not answer.",
      },
      { status: response.status },
    );
  }

  const answer = readOutputText(payload);
  return Response.json({ answer, model }, { headers: { "Cache-Control": "no-store" } });
}
