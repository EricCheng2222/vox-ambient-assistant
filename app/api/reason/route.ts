import { answerText, backgroundState, fetchBackground, isJobId, settleAnswerJob, startAnswerJob, touchAnswerJob, type BackgroundPayload } from "@/lib/answer-jobs";
import { withoutLinkMarkup } from "@/lib/answer-text";
import { askFirstAvailable, EXPERT_MODELS } from "@/lib/models";
import { requireUser } from "@/lib/auth";
import { earlierMessages, parseRecentMessages } from "@/lib/conversation-context";
import { formatMemoryContext } from "@/lib/memory";
import { WRITTEN_LAYOUT_INSTRUCTION } from "@/lib/answer-layout";
import { listMemories } from "@/lib/memory-store";
import { loadProfileContext } from "@/lib/profile-store";
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
    jobId?: unknown;
    written?: unknown;
    eventStream?: unknown;
  };
  // With a job id the answer is worked out in the background, so it survives
  // the app going away: whoever is there when it finishes gets it.
  const jobId = isJobId(body.jobId) ? body.jobId : null;
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
  const models = isExpert ? EXPERT_MODELS : (["gpt-5.6-terra"] as const);
  const remembered = await listMemories(auth.user.id, 24).catch((error) => {
    console.error("Reasoning without saved memory", error);
    return [];
  });
  const profileBackground = await loadProfileContext(
    auth.user.id,
    remembered.map((memory) => memory.content),
  );
  const memoryContext =
    (remembered.length ? `\n\n${formatMemoryContext(remembered)}` : "") +
    (profileBackground ? `\n\n${profileBackground}` : "");
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

  let model: string = models[0];
  // One time limit for the whole answer, however many models are tried: the
  // user is waiting, and a search that hasn't come back by now won't be worth it.
  const deadline = AbortSignal.timeout(isExpert ? 120_000 : 60_000);
  let response: Response;
  try {
    response = await askFirstAvailable(models, (candidate) => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: deadline,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: (model = candidate),
      input,
      instructions:
        (body.written === true
          ? // A typed conversation: the answer is read, so it is laid out for reading.
            `Prepare an accurate answer for an assistant to show in a chat. Answer the latest user message as the next turn of the conversation you are given: resolve references to earlier turns and do not repeat what was already said. Use plain language. ${WRITTEN_LAYOUT_INSTRUCTION} Do not mention model routing.\n\n`
          : "Prepare an accurate answer for a voice assistant to speak aloud. Answer the latest user message as the next turn of the conversation you are given: resolve references to earlier turns and do not repeat what was already said. Use plain language, spoken-friendly sentences, and no markdown. Do not mention model routing.\n\n") +
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
      ...(jobId ? { background: true, store: true } : { store: false }),
    }),
  }));
  } catch (error) {
    if (!deadline.aborted) throw error;
    console.error("Reasoning request timed out", isExpert ? "expert" : isWeb ? "web" : "balanced");
    return Response.json(
      { error: isWeb ? "That search took longer than I wait for an answer. Ask me again, or for something narrower." : "That took longer than I wait for an answer. Ask me again, or for something narrower." },
      { status: 504, headers: { "Cache-Control": "no-store" } },
    );
  }

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

  let finished: BackgroundPayload = payload as BackgroundPayload;
  if (jobId && finished.id) {
    const key = `${auth.user.id}:${jobId}`;
    const responseId = finished.id;
    await startAnswerJob(auth.user.id, jobId, responseId, new Date().toISOString());
    // The event subscriber watches the durable job, rather than keeping this
    // POST open. Disconnecting the subscriber never cancels the provider job.
    if (body.eventStream === true) {
      return Response.json({ pending: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
    }
    const until = Date.now() + (isExpert ? 120_000 : 60_000);
    let state = backgroundState(finished);
    for (let polls = 1; state === "working" && Date.now() < until; polls += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      finished = (await fetchBackground(apiKey, responseId)) ?? finished;
      state = backgroundState(finished);
      // Still here, still waiting: the server's own timer leaves this job alone.
      if (polls % 4 === 0) await touchAnswerJob(key, new Date().toISOString());
    }
    // Not ready yet: it keeps going, and the app keeps asking (GET /api/answer-jobs).
    if (state === "working") return Response.json({ pending: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
    if (state === "failed") {
      await settleAnswerJob(key, "failed", new Date().toISOString());
      return Response.json({ error: "The selected reasoning model could not answer." }, { status: 502 });
    }
    // Handing it over is not the same as it arriving: the job stays open until
    // the app confirms (POST /api/answer-jobs). If it never does, the server's
    // timer leaves the answer in the conversation.
    await touchAnswerJob(key, new Date().toISOString());
  }
  const answer = jobId ? answerText(finished) : withoutLinkMarkup(readOutputText(payload));
  if (!isWeb) {
    return Response.json({ answer, model }, { headers: { "Cache-Control": "no-store" } });
  }
  const stage = webStage(text, (jobId ? finished : payload) as ResponsesPayload);
  return Response.json({ answer, model, stage }, { headers: { "Cache-Control": "no-store" } });
}
