import { requireUser } from "@/lib/auth";
import { getCurrentTimeContext } from "@/lib/time-context";

type JevRoute =
  | "silence"
  | "realtime"
  | "balanced_reasoning"
  | "expert_reasoning"
  | "live_web"
  | "create_reminder"
  | "create_file";

type ContextMode = "continue" | "fresh";
type TurnState = "wait" | "complete";

type RecentMessage = {
  role: "user" | "assistant";
  text: string;
};

type SpeechTiming = {
  speechDurationMs: number | null;
  estimatedTrailingSoundMs: number | null;
  silenceBeforeMs: number | null;
  transcriptReadyDelayMs: number | null;
};

const ROUTES = new Set<JevRoute>([
  "silence",
  "realtime",
  "balanced_reasoning",
  "expert_reasoning",
  "live_web",
  "create_reminder",
  "create_file",
]);

const CONTEXT_MODES = new Set<ContextMode>(["continue", "fresh"]);
const TURN_STATES = new Set<TurnState>(["wait", "complete"]);

function duration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.max(0, Math.min(value, 600_000)))
    : null;
}

function speechTiming(value: unknown): SpeechTiming | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SpeechTiming>;
  return {
    speechDurationMs: duration(candidate.speechDurationMs),
    estimatedTrailingSoundMs: duration(candidate.estimatedTrailingSoundMs),
    silenceBeforeMs: duration(candidate.silenceBeforeMs),
    transcriptReadyDelayMs: duration(candidate.transcriptReadyDelayMs),
  };
}

function fallbackTurnState(text: string, pendingText: string): TurnState {
  const value = [pendingText, text].filter(Boolean).join(" ").trim();
  if (!value) return "complete";

  if (/[?？!！。]\s*$/.test(value)) return "complete";
  if (/(?:\.{3,}|…+)\s*$/.test(value)) return "wait";

  const trailingThought =
    /(?:\b(?:because|but|and|so|then|if|when|which|that|although|unless|or|like)\b|(?:因為|但是|可是|不過|然後|所以|如果|就是|還有|而且|那個|我想一下|讓我想想|嗯|呃))[\s,，、]*$/iu;
  if (trailingThought.test(value)) return "wait";

  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (
    pendingText &&
    words.length > 0 &&
    words.every((word) => /^(um+|uh+|hmm+|er+|let|me|think)$/.test(word))
  ) {
    return "wait";
  }

  return "complete";
}

function fallbackRoute(text: string): JevRoute {
  const value = text.trim().toLowerCase();
  const words = value.replace(/[^a-z\s]/g, "").split(/\s+/).filter(Boolean);
  if (
    !value ||
    (words.length > 0 &&
      words.every((word) => /^(um+|uh+|hmm+|okay|right|yeah)$/.test(word)))
  ) {
    return "silence";
  }
  if (
    /\b(remind me|set (?:a |an )?(?:reminder|alarm)|schedule (?:a |an )?reminder)\b/.test(
      value,
    ) ||
    /(提醒我|設(?:定)?提醒|新增提醒|排程提醒)/.test(value)
  ) {
    return "create_reminder";
  }
  if (
    /\b(create|make|write|save|generate)\b.*\b(file|document|doc|checklist|plan|report|csv|json|html|script|code)\b/.test(
      value,
    ) ||
    /(建立|製作|幫我寫|存成).*(檔案|文件|清單|計畫|報告|csv|json|html|程式碼)/.test(value)
  ) {
    return "create_file";
  }
  if (
    /\b(what(?:'s| is) (?:the )?(?:time|date|day)|what time is it|today'?s date|current time)\b/.test(
      value,
    ) ||
    /(現在幾點|現在時間|今天幾號|今天日期|今天星期幾|今天禮拜幾)/.test(value)
  ) {
    return "realtime";
  }
  if (/\b(today|latest|current|currently|news|weather|price|score|schedule)\b/.test(value)) {
    return "live_web";
  }
  if (/\b(high[- ]stakes|critical|medical emergency|legal strategy)\b/.test(value)) {
    return "expert_reasoning";
  }
  if (/\b(analyze|compare|strategy|plan|trade-?off|prove|diagnose)\b/.test(value)) {
    return "balanced_reasoning";
  }
  return "realtime";
}

function fallbackContextMode(text: string, recentMessages: RecentMessage[]): ContextMode {
  if (recentMessages.length === 0) return "fresh";
  if (
    /\b(?:new|different|unrelated) (?:topic|question)|\bchanging (?:the )?subject\b/i.test(
      text,
    ) ||
    /(?:換個話題|換一個話題|題外話|另外一個問題|不同的主題)/.test(text)
  ) {
    return "fresh";
  }
  return "continue";
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as {
    text?: string;
    pendingText?: string;
    pendingAgeMs?: number;
    timing?: unknown;
    pendingTimings?: unknown[];
    allowWait?: boolean;
    recentMessages?: RecentMessage[];
  };
  const text = body.text?.trim().slice(0, 6000) ?? "";
  const pendingText = body.pendingText?.trim().slice(0, 6000) ?? "";
  const allowWait = body.allowWait !== false;
  const completeText = [pendingText, text].filter(Boolean).join(" ").trim();
  const currentTiming = speechTiming(body.timing);
  const pendingTimings = Array.isArray(body.pendingTimings)
    ? body.pendingTimings
        .map(speechTiming)
        .filter((value) => value !== null)
        .slice(-6)
    : [];
  const allTimings = [...pendingTimings, ...(currentTiming ? [currentTiming] : [])];
  const timingSummary = {
    current_fragment: currentTiming,
    pending_fragments: pendingTimings,
    fragment_count: allTimings.length,
    combined_speech_ms: allTimings.reduce(
      (total, timing) => total + (timing.speechDurationMs ?? 0),
      0,
    ),
    current_estimated_trailing_sound_ms:
      currentTiming?.estimatedTrailingSoundMs ?? null,
    pending_for_ms: duration(body.pendingAgeMs),
  };
  const recentMessages = Array.isArray(body.recentMessages)
    ? body.recentMessages
        .filter(
          (message): message is RecentMessage =>
            (message?.role === "user" || message?.role === "assistant") &&
            typeof message?.text === "string",
        )
        .slice(-6)
        .map((message) => ({ ...message, text: message.text.slice(0, 400) }))
    : [];
  if (!text) {
    return Response.json({
      route: "silence",
      turnState: "complete",
      contextMode: "continue",
      source: "fallback",
    });
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    return Response.json({
      route: fallbackRoute(completeText),
      turnState: allowWait ? fallbackTurnState(text, pendingText) : "complete",
      contextMode: pendingText
        ? "continue"
        : fallbackContextMode(text, recentMessages),
      source: "fallback",
    });
  }

  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          current_utterance: text,
          pending_utterance: pendingText || null,
          complete_utterance_if_continued: completeText,
          voice_pause_detection_enabled: allowWait,
          delivery_timing: timingSummary,
          recent_conversation: recentMessages,
          authoritative_clock: getCurrentTimeContext(),
        },
        questions: {
          turn_state: {
            type: "choice",
            instructions:
              "Decide whether the person has finished the thought and the assistant should answer now. Choose wait only when voice pause detection is enabled and the current speech is likely a thinking pause, self-correction, trailing clause, unfinished list, or otherwise semantically incomplete. A pending utterance is an earlier fragment that the assistant deliberately waited on; combine it with the current utterance when judging completion. Use delivery_timing as supporting evidence: a filler or conspicuously prolonged trailing sound in the current fragment can strengthen the case for wait. Once a pending thought receives a semantically complete continuation, choose complete regardless of how long or hesitant the earlier fragment was. Timing is approximate and must never override clearly complete words. transcriptReadyDelayMs is processing delay, not proof that the person was thinking. Do not choose wait merely because a complete request is short, hesitant, informal, slow, or lacks punctuation. Greetings and complete questions should be complete. When genuinely uncertain whether the person is still formulating the same thought, prefer wait once so the assistant does not interrupt. If voice pause detection is disabled, always choose complete.",
            criteria: {
              wait:
                "Stay vocally silent, show only a subtle text cue, and wait for the person to continue the same thought.",
              complete:
                "The thought is complete enough for the assistant to route and answer now.",
            },
          },
          route: {
            type: "choice",
            instructions:
              "Route the complete utterance for an ambient voice assistant. When a pending utterance exists, treat the current utterance as its continuation unless the person clearly abandoned it or started a different self-contained request. Choose silence when the speech is incidental, filler, background conversation, not directed at the assistant, or explicitly asks for no reply. Choose create_reminder only when the user explicitly asks to be reminded or notified at a future time. Choose create_file only when the user explicitly wants the assistant to produce or save a downloadable file, document, checklist, report, table, data file, web page, or source-code file. Choose realtime for greetings, casual conversation, simple stable facts, brief clarifications, and questions about the current local time, date, or weekday because an authoritative clock is provided. Choose balanced_reasoning for multi-step analysis, comparisons, planning, or nuanced explanations that should be spoken rather than saved as a file. Choose expert_reasoning only for exceptionally difficult, high-stakes, or deeply technical work where maximum accuracy matters. Choose live_web when the answer depends on current, recent, changing, or location-specific information other than the supplied local time and date.",
            criteria: {
              silence: "The assistant should not speak.",
              realtime:
                "Use the low-latency realtime voice model, including for current local time and date.",
              balanced_reasoning: "Use the balanced reasoning model.",
              expert_reasoning: "Use the most capable expert reasoning model.",
              live_web: "Use a model with live web search.",
              create_reminder:
                "Create a persistent reminder with a future due time and notification.",
              create_file: "Create and save a downloadable file for the user.",
            },
          },
          context_mode: {
            type: "choice",
            instructions:
              "Decide whether the next assistant response needs the recent conversation. A pending utterance always requires continue because it is part of the current thought. Otherwise, choose continue when the utterance follows up on, corrects, refers to, or depends on anything in the recent conversation. Pronouns, ellipsis, phrases such as 'that one' or 'what about', and an ongoing task all require continue. Choose fresh only when the utterance is clearly self-contained and starts an unrelated topic, so the older conversation would add no useful meaning. When uncertain, choose continue. This decision controls only short-term model context; durable user memories are handled separately.",
            criteria: {
              continue:
                "Keep recent conversation because the utterance may depend on it or continues the same topic or task.",
              fresh:
                "Start a fresh model context because this is clearly an independent topic and prior turns are unnecessary.",
            },
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Jev returned ${response.status}`);
    const payload = (await response.json()) as {
      answers?: {
        turn_state?: { choice?: string; confidence?: number };
        route?: { choice?: string; confidence?: number };
        context_mode?: { choice?: string; confidence?: number };
      };
    };
    const choice = payload.answers?.route?.choice as JevRoute | undefined;
    if (!choice || !ROUTES.has(choice)) throw new Error("Invalid Jev route");
    const turnChoice = payload.answers?.turn_state?.choice as TurnState | undefined;
    const turnState =
      allowWait && turnChoice && TURN_STATES.has(turnChoice)
        ? turnChoice
        : "complete";
    const contextChoice = payload.answers?.context_mode?.choice as
      | ContextMode
      | undefined;
    const contextMode = pendingText
      ? "continue"
      : contextChoice && CONTEXT_MODES.has(contextChoice)
        ? contextChoice
        : fallbackContextMode(text, recentMessages);

    return Response.json({
      route: choice,
      confidence: payload.answers?.route?.confidence ?? null,
      turnState,
      turnConfidence: payload.answers?.turn_state?.confidence ?? null,
      contextMode,
      contextConfidence: payload.answers?.context_mode?.confidence ?? null,
      source: "jev",
    });
  } catch (error) {
    console.error("Jev routing failed", error);
    return Response.json({
      route: fallbackRoute(completeText),
      turnState: allowWait ? fallbackTurnState(text, pendingText) : "complete",
      contextMode: pendingText
        ? "continue"
        : fallbackContextMode(text, recentMessages),
      source: "fallback",
    });
  }
}
