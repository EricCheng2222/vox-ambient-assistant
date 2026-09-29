import { requireUser } from "@/lib/auth";
import { earlierMessages, parseRecentMessages } from "@/lib/conversation-context";
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
import {
  responseLanguageInstruction,
  selectResponseLanguage,
} from "@/lib/response-language";
import {
  parseResponsePosture,
  responsePostureInstruction,
} from "@/lib/response-posture";
import {
  memoryUseInstruction,
  parseConversationRitual,
  parseMemoryUse,
  ritualInstruction,
} from "@/lib/social-policy";
import type { StageContent } from "@/lib/stage";
import { collectSources, type ResponsesPayload } from "@/lib/stage-answer";

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

/**
 * The stage for a web answer: the pages it cited. The facts pulled out of the
 * answer come separately from /api/stage/facts, so speech never waits on them.
 */
function webStage(question: string, payload: ResponsesPayload): StageContent | null {
  const sources = collectSources(payload);
  if (!sources.length) return null;
  return {
    id: crypto.randomUUID(),
    title: question.replace(/\s+/g, " ").trim().slice(0, 120),
    sources,
    blocks: [],
    createdAt: Date.now(),
  };
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
    responsePosture?: unknown;
    memoryUse?: unknown;
    ritual?: unknown;
    recentMessages?: unknown;
  };
  const text = body.text?.trim().slice(0, 12000) ?? "";
  const route = body.route;
  const replyLength = parseReplyLength(body.replyLength);
  const responseLength = parseAdaptiveReplyLength(body.responseLength, replyLength);
  const responsePosture = parseResponsePosture(body.responsePosture, "answer");
  const memoryUse = parseMemoryUse(body.memoryUse);
  const ritual = parseConversationRitual(body.ritual);
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
  const recentMessages = parseRecentMessages(body.recentMessages);
  const languageInstruction = responseLanguageInstruction(
    selectResponseLanguage(text, recentMessages),
  );
  // The model sees the conversation so far as real turns, then the request.
  const input = [
    ...earlierMessages(recentMessages, text).map((message) => ({
      role: message.role,
      content: message.text,
    })),
    { role: "user" as const, content: text },
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      instructions:
        "Prepare an accurate answer for a voice assistant to speak aloud. Answer the latest user message as the next turn of the conversation you are given: resolve references to earlier turns and do not repeat what was already said. Use plain language, spoken-friendly sentences, and no markdown. Do not mention model routing.\n\n" +
        languageInstruction +
        timeContext +
        memoryContext +
        `\n\n${responsePostureInstruction(responsePosture)}` +
        `\n\n${memoryUseInstruction(memoryUse)}` +
        `\n\n${ritualInstruction(ritual)}` +
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
  if (!isWeb) {
    return Response.json({ answer, model }, { headers: { "Cache-Control": "no-store" } });
  }
  const stage = webStage(text, payload as ResponsesPayload);
  return Response.json({ answer, model, stage }, { headers: { "Cache-Control": "no-store" } });
}
