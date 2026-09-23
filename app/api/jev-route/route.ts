import { requireUser } from "@/lib/auth";
import { boundedRecentMessages } from "@/lib/conversation-context";
import {
  isOpenWorkspaceRequest,
  isStandaloneVoiceConfirmation,
} from "@/lib/desktop-action-route";
import {
  hasDesktopControlEvidence,
  isDesktopControlRequest,
} from "@/lib/desktop-control-route";
import { isLocalCodexTask } from "@/lib/local-codex-route";
import { listMemories } from "@/lib/memory-store";
import {
  adaptiveReplyLengthChoices,
  defaultAdaptiveReplyLength,
  mirroredAdaptiveReplyLength,
  parseAdaptiveReplyLength,
  parseReplyLength,
  userTurnLengthSignals,
  type AdaptiveReplyLength,
  type ReplyLength,
} from "@/lib/reply-length";
import {
  fallbackResponsePosture,
  parseResponsePosture,
} from "@/lib/response-posture";
import {
  fallbackConversationRitual,
  parseConversationRitual,
  parseMemoryUse,
  type ConversationRitual,
} from "@/lib/social-policy";
import {
  getSocialEligibility,
  recordSocialDecision,
  type SocialEligibility,
} from "@/lib/social-state-store";
import { getCurrentTimeContext } from "@/lib/time-context";
import {
  fallbackVisionNeed,
  parseVisionNeed,
  type VisionNeed,
} from "@/lib/vision";
import { claimVisionAnalysis } from "@/lib/vision-usage-store";

type JevRoute =
  | "silence"
  | "realtime"
  | "balanced_reasoning"
  | "expert_reasoning"
  | "live_web"
  | "create_reminder"
  | "create_file"
  | "desktop_action"
  | "desktop_control"
  | "local_codex";

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
  "desktop_action",
  "desktop_control",
  "local_codex",
]);

const TURN_STATES = new Set<TurnState>(["wait", "complete"]);

const unavailableSocialEligibility: SocialEligibility = {
  localDate: "",
  localHour: -1,
  morning: false,
  night: false,
  naturalCallback: false,
  emotionalFollowup: false,
};

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

function isFillerOnly(text: string) {
  const fragments = text
    .trim()
    .toLocaleLowerCase()
    .split(/[\s,，.。!！?？、…:：;；~-]+/u)
    .filter(Boolean);

  return (
    fragments.length > 0 &&
    fragments.every((fragment) =>
      /^(?:um+|uh+|h+m+|er+|ah+|eh+|嗯+|呃+|欸+|誒+|喔+|哦+|啊+|唔+)$/u.test(
        fragment,
      ),
    )
  );
}

function fallbackTurnState(text: string, pendingText: string): TurnState {
  const value = [pendingText, text].filter(Boolean).join(" ").trim();
  if (!value) return "complete";
  if (!pendingText && isFillerOnly(text)) return "complete";

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

function fallbackRoute(
  text: string,
  localCodexAvailable = false,
  desktopActionsAvailable = false,
  desktopControlAvailable = false,
): JevRoute {
  const value = text.trim().toLowerCase();
  if (!value || isFillerOnly(value)) {
    return "silence";
  }
  if (desktopActionsAvailable && isOpenWorkspaceRequest(text)) {
    return "desktop_action";
  }
  if (desktopControlAvailable && isDesktopControlRequest(text)) {
    return "desktop_control";
  }
  if (localCodexAvailable && isLocalCodexTask(text)) {
    return "local_codex";
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

function fallbackResponseLength(
  text: string,
  preference: ReplyLength,
  route: JevRoute,
): AdaptiveReplyLength {
  if (route === "silence") return defaultAdaptiveReplyLength(preference);
  return mirroredAdaptiveReplyLength(text, preference, {
    compact:
      route === "create_reminder" ||
      route === "create_file" ||
      route === "desktop_action" ||
      route === "desktop_control" ||
      route === "local_codex",
  });
}

async function reserveVisionIfNeeded(
  ownerId: string,
  visionNeed: VisionNeed,
  visionAvailable: boolean,
) {
  if (visionNeed === "none" || !visionAvailable) return null;
  const allowance = await claimVisionAnalysis(ownerId);
  return allowance.allowed ? null : allowance.reason;
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
    replyLength?: unknown;
    visionAvailable?: boolean;
    localCodexAvailable?: boolean;
    desktopActionsAvailable?: boolean;
    desktopControlAvailable?: boolean;
    desktopAppContext?: string;
  };
  const text = body.text?.trim().slice(0, 6000) ?? "";
  const pendingText = body.pendingText?.trim().slice(0, 6000) ?? "";
  const allowWait = body.allowWait !== false;
  const replyLength = parseReplyLength(body.replyLength);
  const localCodexAvailable = body.localCodexAvailable === true;
  const desktopActionsAvailable = body.desktopActionsAvailable === true;
  const desktopControlAvailable = body.desktopControlAvailable === true;
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
    ? boundedRecentMessages(
        body.recentMessages.filter(
          (message): message is RecentMessage =>
            (message?.role === "user" || message?.role === "assistant") &&
            typeof message?.text === "string",
        ),
      )
    : [];
  if (!text) {
    return Response.json({
      route: "silence",
      turnState: "complete",
      responsePosture: "acknowledge",
      responseLength: defaultAdaptiveReplyLength(replyLength),
      memoryUse: "none",
      ritual: "none",
      visionNeed: "none",
      source: "fallback",
    });
  }

  const now = new Date();
  const [memories, socialEligibility] = await Promise.all([
    listMemories(auth.user.id, 8).catch((error) => {
      console.error("Jev routing without saved memory", error);
      return [];
    }),
    getSocialEligibility(auth.user.id, now).catch((error) => {
      console.error("Jev routing without social state", error);
      return unavailableSocialEligibility;
    }),
  ]);

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    const route = fallbackRoute(
      completeText,
      localCodexAvailable,
      desktopActionsAvailable,
      desktopControlAvailable,
    );
    const turnState = allowWait ? fallbackTurnState(text, pendingText) : "complete";
    const visionNeed =
      turnState === "complete" &&
      route !== "silence" &&
      route !== "desktop_action" &&
      route !== "desktop_control" &&
      route !== "local_codex"
        ? fallbackVisionNeed(completeText)
        : "none";
    const ritual: ConversationRitual =
      turnState === "complete" &&
      route !== "silence" &&
      route !== "create_reminder" &&
      route !== "create_file" &&
      route !== "desktop_action" &&
      route !== "desktop_control" &&
      route !== "local_codex"
        ? fallbackConversationRitual(completeText, socialEligibility)
        : "none";
    if (ritual !== "none") {
      await recordSocialDecision(
        auth.user.id,
        { ritual, memoryUse: "none" },
        socialEligibility.localDate,
        now,
      ).catch((error) => console.error("Social state update failed", error));
    }
    return Response.json({
      route,
      turnState,
      responsePosture: fallbackResponsePosture(completeText),
      responseLength: fallbackResponseLength(completeText, replyLength, route),
      memoryUse: "none",
      ritual,
      visionNeed,
      visionBlocked: await reserveVisionIfNeeded(
        auth.user.id,
        visionNeed,
        body.visionAvailable === true,
      ),
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
          remembered_context: memories.map((memory) => ({
            id: memory.id,
            category: memory.category,
            content: memory.content.slice(0, 280),
            updated_at: memory.updatedAt,
          })),
          social_eligibility: {
            local_hour: socialEligibility.localHour,
            good_morning_available: socialEligibility.morning,
            good_night_available: socialEligibility.night,
            natural_callback_available: socialEligibility.naturalCallback,
            emotional_followup_available: socialEligibility.emotionalFollowup,
          },
          authoritative_clock: getCurrentTimeContext(),
          reply_length_preference: replyLength,
          user_length_signals: {
            current_turn: userTurnLengthSignals(completeText),
            recent_user_turns: recentMessages
              .filter((message) => message.role === "user")
              .slice(-3)
              .map((message) => userTurnLengthSignals(message.text)),
          },
          camera_preview_available: body.visionAvailable === true,
          local_codex_available: localCodexAvailable,
          desktop_actions_available: desktopActionsAvailable,
          desktop_control_available: desktopControlAvailable,
          recent_desktop_app: desktopControlAvailable && typeof body.desktopAppContext === "string" ? body.desktopAppContext.slice(0, 80) : null,
        },
        questions: {
          ...(desktopControlAvailable ? { desktop_app: {
            type: "choice",
            instructions: "Infer the target app ONLY for a user request to act on their computer. They need not name an app or use fixed command words. Use recent_desktop_app for references like pause it or the fifth video when relevant; do not reuse it for an unrelated task. For a new website-opening request with no browser preference choose Safari; respect an explicitly named Chrome. Use Finder for files/folders, Preview for PDF viewing, Notes for notes, Calculator for calculations in an app, TextEdit for plain text, vscode for editor UI. Choose none for ordinary conversation, conceptual questions, or genuinely ambiguous targets. Do not invent current screen contents. This is target selection, never permission to perform a sensitive action.",
            criteria: { none: "No unambiguous computer action target.", safari: "Safari browser", chrome: "Google Chrome browser", finder: "Finder files and folders", preview: "Preview document viewer", notes: "Notes", calculator: "Calculator", textedit: "TextEdit", vscode: "Visual Studio Code", music: "Apple Music", podcasts: "Podcasts", tv: "Apple TV", photos: "Photos", calendar: "Calendar", reminders: "Reminders", maps: "Maps", weather: "Weather", clock: "Clock", contacts: "Contacts", quicktime: "QuickTime Player", mail: "Mail", messages: "Messages" },
          } } : {}),
          ...(desktopControlAvailable ? { computer_use_mode: {
            type: "choice",
            instructions: "Select the local Computer Use execution tier, not permissions. Use fast for a single clear routine action such as pause/resume a video, scroll, open an app, or click a specified visible item. Use standard for multi-step tasks, unclear references, unfamiliar interfaces, or tasks requiring interpretation. Resolve app-less follow-ups using recent_desktop_app and recent_conversation. When uncertain choose standard. This decision never authorizes sensitive actions.",
            criteria: { fast: "GPT-5.6 Luna with low reasoning for simple actions.", standard: "GPT-5.6 Terra with medium reasoning for multi-step or ambiguous tasks." },
          } } : {}),
          turn_state: {
            type: "choice",
            instructions:
              "Decide whether the person has finished the thought and the assistant should answer now. Choose wait only when voice pause detection is enabled and the current speech is likely a thinking pause, self-correction, trailing clause, unfinished list, or otherwise semantically incomplete. A pending utterance is an earlier fragment that the assistant deliberately waited on; combine it with the current utterance when judging completion. Use delivery_timing as supporting evidence: a filler or conspicuously prolonged trailing sound in the current fragment can strengthen the case for wait when it follows a pending thought. A standalone filler such as um, uh, 嗯, 呃, or 欸 with no pending utterance should be complete and routed to silence, not wait, because it does not justify showing a new waiting cue. Once a pending thought receives a semantically complete continuation, choose complete regardless of how long or hesitant the earlier fragment was. Timing is approximate and must never override clearly complete words. transcriptReadyDelayMs is processing delay, not proof that the person was thinking. Do not choose wait merely because a complete request is short, hesitant, informal, slow, or lacks punctuation. Greetings and complete questions should be complete. When genuinely uncertain whether the person is still formulating the same thought, prefer wait once so the assistant does not interrupt. If voice pause detection is disabled, always choose complete.",
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
              "Route the complete utterance for an ambient voice assistant. When a pending utterance exists, treat the current utterance as its continuation unless the person clearly abandoned it or started a different self-contained request. Choose silence when the speech is incidental, filler, background conversation, not directed at the assistant, or explicitly asks for no reply. Choose create_reminder only when the user explicitly asks to be reminded or notified at a future time. Choose create_file only when the user explicitly wants the assistant to produce or save a downloadable file, document, checklist, report, table, data file, web page, or source-code file. Choose desktop_action only when desktop_actions_available is true and the user explicitly asks to open, show, or reveal the already selected local project folder. This direct Finder action takes precedence over every other desktop route and does not require Computer Use. Choose desktop_control only when desktop_control_available is true and the person explicitly asks to launch, focus, click, scroll, select, navigate, type in, read, or otherwise use Finder, Safari, Google Chrome, Preview, Notes, Calculator, TextEdit, or Visual Studio Code. Never choose desktop_control for deleting, sending, posting, sharing, uploading, purchasing, logging in, entering credentials, installing, downloading, changing settings, Terminal, or shell commands. Choose local_codex only when local_codex_available is true and the user explicitly asks to delegate substantive software work to Codex or asks the assistant to inspect, debug, modify, implement, test, or build a local software project. Never choose local_codex merely to open or reveal a folder or operate another app. Do not choose local_codex for conceptual programming questions, general explanations, casual mentions of code, or ordinary Vox file creation. Choose realtime for greetings, casual conversation, simple stable facts, brief clarifications, and questions about the current local time, date, or weekday because an authoritative clock is provided. Choose balanced_reasoning for multi-step analysis, comparisons, planning, or nuanced explanations that should be spoken rather than saved as a file. Choose expert_reasoning only for exceptionally difficult, high-stakes, or deeply technical work where maximum accuracy matters. Choose live_web when the answer depends on current, recent, changing, or location-specific information other than the supplied local time and date.",
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
              ...(desktopActionsAvailable
                ? {
                    desktop_action:
                      "Ask for voice confirmation, then open the already selected project folder in Finder without invoking Codex.",
                  }
                : {}),
              ...(desktopControlAvailable
                ? {
                    desktop_control:
                      "Ask for voice confirmation, then launch an approved app directly or use tightly restricted, read-only mouse interaction in that app.",
                  }
                : {}),
              ...(localCodexAvailable
                ? {
                    local_codex:
                      "Ask the local Codex agent to work inside a user-selected software project after native confirmation.",
                  }
                : {}),
            },
          },
          conversation_move: {
            type: "choice",
            instructions:
              "Choose exactly one socially natural conversational move for the assistant's next response. The route question separately handles staying silent. Advice is never the default: choose advise only when the person explicitly requests advice, recommendations, steps, planning, decision support, or a solution, or when immediate safety makes guidance necessary. Merely mentioning a goal, frustration, purchase, health effort, relationship, or difficult situation is not a request for advice. Detect repair when the person corrects the assistant, says it misunderstood, rejects its framing, or appears disengaged after a mismatch; repair briefly and change approach instead of defending the earlier answer. Use acknowledge for ordinary updates where a specific warm reaction is enough. Use listen for emotion or vulnerability that should be heard rather than fixed. Use joke only when the person's tone makes playful reciprocity safe. Use ask only when one genuine, low-pressure question is more natural than making a statement; never ask merely to keep the conversation going. Use share when a relevant observation or association would make the exchange feel reciprocal without becoming advice. Use answer for a direct factual or explanatory question. Use recent conversation to understand what went wrong or what would feel natural now.",
            criteria: {
              acknowledge:
                "Give a natural, specific acknowledgement without turning the moment into advice or an interview.",
              listen:
                "Reflect the person's feeling or meaning and leave room for them to continue without trying to fix it.",
              joke:
                "Match a clearly playful tone with one light, safe, context-aware remark.",
              ask:
                "Ask one genuinely interesting, low-pressure question because curiosity is the best next move.",
              share:
                "Contribute one relevant observation, association, or small personal-style thought as a conversational equal.",
              answer:
                "Answer the direct question or explain the requested information without unsolicited advice.",
              advise:
                "Give proportionate practical advice because the person clearly requested it or safety requires it.",
              repair:
                "Acknowledge a mismatch or misunderstanding and respond again from the person's corrected direction without defensiveness.",
            },
          },
          memory_timing: {
            type: "choice",
            instructions:
              "Decide whether this exact turn is a socially good moment to reference older remembered context. Strongly prefer none. Choose natural_callback only when one saved detail is directly relevant to what the person just said and mentioning it would feel like a friend's effortless recollection rather than database retrieval. Choose emotional_followup only when a saved unresolved emotional thread is directly relevant, the present moment is calm and unhurried, and a tentative check-in would not interrupt a task, urgent request, distress, or topic change. Never select a mode whose matching social_eligibility flag is false. Do not use memory merely to demonstrate that it exists, and never stack multiple callbacks.",
            criteria: {
              none:
                "Do not surface older personal context; it is irrelevant, ill-timed, too sensitive, or would feel forced.",
              natural_callback:
                "One directly relevant remembered detail can be woven in casually and the callback cooldown is available.",
              emotional_followup:
                "One directly relevant unresolved feeling can be revisited gently and the emotional follow-up cooldown is available.",
            },
          },
          ritual: {
            type: "choice",
            instructions:
              "Decide whether to include a tiny relationship ritual in this response. Strongly prefer none. Choose good_morning only when it is available, this appears to be the first meaningful interaction of the local morning, and a brief greeting will not delay an urgent or purely transactional request. Choose good_night only when it is available and the person explicitly says good night, says they are going to bed or sleep, or naturally closes a late conversation. Never infer bedtime from the clock alone. A ritual must be brief, natural, and used at most once per local day.",
            criteria: {
              none: "No morning or bedtime ritual naturally fits this turn.",
              good_morning:
                "A brief good-morning greeting fits this first meaningful morning interaction.",
              good_night:
                "A brief good-night sign-off fits because the person is explicitly winding down or going to sleep.",
            },
          },
          response_length: {
            type: "choice",
            instructions:
              `Choose the most natural amount for the assistant to say on this turn. Use the person's own conversational scale as the rule of thumb: estimate how much they said in the complete current utterance, then smooth that estimate against their recent user turns so a tiny follow-up does not erase an established speaking style. Apply the saved preference as a meaningful bias: Less should usually be about one level shorter than the natural mirror, Balanced should stay near the mirror, and More should usually be about one level fuller. The preference is still a range, not a fixed quota. The needs of the answer may move the result by one level: quick acknowledgements, greetings, simple facts, emotionally sensitive moments, and transactional confirmations can stay compact; teaching, nuanced explanations, comparisons, difficult decisions, or explicit requests for detail can use more room. Mirror amount and conversational rhythm, not filler words, repetition, hesitation, or exact word count. Avoid repeatedly choosing the same length when the user's turns differ, and never add padding merely to create variety. Choose only from the provided criteria.`,
            criteria: Object.fromEntries(
              adaptiveReplyLengthChoices(replyLength).map((choice) => [
                choice,
                {
                  minimal: "A phrase or one compact spoken sentence.",
                  brief: "A direct answer in a small handful of spoken sentences.",
                  standard: "A natural complete answer with moderate explanation.",
                  detailed: "A developed conversational answer with useful context.",
                  expansive: "A fuller spoken exploration with reasoning or examples.",
                }[choice],
              ]),
            ),
          },
          visual_need: {
            type: "choice",
            instructions:
              "Decide whether the user explicitly asks the assistant to inspect the current camera view. Strongly prefer none. Choose inspect_low only for a direct request to look, see, identify a visible object, assess appearance, or answer a question that clearly depends on the camera right now. Choose inspect_high only when the user explicitly asks to read small or exact text, inspect fine detail, a label, serial number, screen, or document. Never inspect merely because a camera preview is available, because the user mentions a visual topic, or for proactive conversation. A camera preview being unavailable does not change whether inspection was requested; it only means the client will explain that it cannot look yet.",
            criteria: {
              none:
                "No current-frame visual inspection was explicitly requested, so no frame should leave the browser.",
              inspect_low:
                "The user explicitly wants a broad look at the current camera frame; send one auto-detail still.",
              inspect_high:
                "The user explicitly needs small text or fine detail from the current camera frame; send one detailed still.",
            },
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Jev returned ${response.status}`);
    const payload = (await response.json()) as {
      answers?: {
        desktop_app?: { choice?: string; confidence?: number };
        computer_use_mode?: { choice?: string; confidence?: number };
        turn_state?: { choice?: string; confidence?: number };
        route?: { choice?: string; confidence?: number };
        conversation_move?: { choice?: string; confidence?: number };
        memory_timing?: { choice?: string; confidence?: number };
        ritual?: { choice?: string; confidence?: number };
        response_length?: { choice?: string; confidence?: number };
        visual_need?: { choice?: string; confidence?: number };
      };
    };
    let choice = payload.answers?.route?.choice as JevRoute | undefined;
    if (!choice || !ROUTES.has(choice)) throw new Error("Invalid Jev route");
    if (
      choice === "desktop_control" &&
      (!hasDesktopControlEvidence(completeText) ||
        isStandaloneVoiceConfirmation(completeText))
    ) {
      choice = "realtime";
    }
    if (choice === "local_codex" && !localCodexAvailable) {
      choice = fallbackRoute(
        completeText,
        false,
        desktopActionsAvailable,
        desktopControlAvailable,
      );
    }
    if (choice === "desktop_action" && !desktopActionsAvailable) {
      choice = fallbackRoute(
        completeText,
        localCodexAvailable,
        false,
        desktopControlAvailable,
      );
    }
    if (choice === "desktop_control" && !desktopControlAvailable) {
      choice = fallbackRoute(
        completeText,
        localCodexAvailable,
        desktopActionsAvailable,
        false,
      );
    }
    const turnChoice = payload.answers?.turn_state?.choice as TurnState | undefined;
    const turnState =
      allowWait && turnChoice && TURN_STATES.has(turnChoice)
        ? turnChoice
        : "complete";
    const responseLength = parseAdaptiveReplyLength(
      payload.answers?.response_length?.choice,
      replyLength,
    );
    const responsePosture = parseResponsePosture(
      payload.answers?.conversation_move?.choice,
      fallbackResponsePosture(completeText),
    );
    let visionNeed = parseVisionNeed(payload.answers?.visual_need?.choice);
    const fallbackVisualNeed = fallbackVisionNeed(completeText);
    const visionNeedConfidence = payload.answers?.visual_need?.confidence ?? 0;
    if (visionNeed === "none" && fallbackVisualNeed !== "none") {
      visionNeed = fallbackVisualNeed;
    } else if (
      visionNeed !== "none" &&
      fallbackVisualNeed === "none" &&
      visionNeedConfidence < 0.8
    ) {
      visionNeed = "none";
    }
    let memoryUse = parseMemoryUse(payload.answers?.memory_timing?.choice);
    let ritual = parseConversationRitual(payload.answers?.ritual?.choice);
    if (
      (memoryUse === "natural_callback" && !socialEligibility.naturalCallback) ||
      (memoryUse === "emotional_followup" && !socialEligibility.emotionalFollowup)
    ) {
      memoryUse = "none";
    }
    if (
      (ritual === "good_morning" && !socialEligibility.morning) ||
      (ritual === "good_night" && !socialEligibility.night)
    ) {
      ritual = "none";
    }
    if (
      turnState === "wait" ||
      choice === "silence" ||
      choice === "create_reminder" ||
      choice === "create_file" ||
      choice === "desktop_action" ||
      choice === "desktop_control" ||
      choice === "local_codex"
    ) {
      memoryUse = "none";
      ritual = "none";
    }
    if (
      turnState === "wait" ||
      choice === "silence" ||
      choice === "desktop_action" ||
      choice === "desktop_control" ||
      choice === "local_codex"
    ) {
      visionNeed = "none";
    }

    const visionBlocked = await reserveVisionIfNeeded(
      auth.user.id,
      visionNeed,
      body.visionAvailable === true,
    );

    await recordSocialDecision(
      auth.user.id,
      { ritual, memoryUse },
      socialEligibility.localDate,
      now,
    ).catch((error) => console.error("Social state update failed", error));

    return Response.json({
      route: choice,
      desktopApp: desktopControlAvailable ? payload.answers?.desktop_app?.choice ?? "none" : "none",
      desktopAppConfidence: desktopControlAvailable ? payload.answers?.desktop_app?.confidence ?? 0 : 0,
      computerUseMode: desktopControlAvailable && payload.answers?.computer_use_mode?.choice === "fast" && (payload.answers.computer_use_mode.confidence ?? 0) >= 0.7 ? "fast" : "standard",
      confidence: payload.answers?.route?.confidence ?? null,
      turnState,
      turnConfidence: payload.answers?.turn_state?.confidence ?? null,
      responsePosture,
      responsePostureConfidence:
        payload.answers?.conversation_move?.confidence ?? null,
      memoryUse,
      memoryUseConfidence: payload.answers?.memory_timing?.confidence ?? null,
      ritual,
      ritualConfidence: payload.answers?.ritual?.confidence ?? null,
      responseLength,
      responseLengthConfidence:
        payload.answers?.response_length?.confidence ?? null,
      visionNeed,
      visionNeedConfidence,
      visionBlocked,
      source: "jev",
    });
  } catch (error) {
    console.error("Jev routing failed", error);
    const route = fallbackRoute(
      completeText,
      localCodexAvailable,
      desktopActionsAvailable,
      desktopControlAvailable,
    );
    const turnState = allowWait ? fallbackTurnState(text, pendingText) : "complete";
    const visionNeed =
      turnState === "complete" &&
      route !== "silence" &&
      route !== "desktop_action" &&
      route !== "desktop_control" &&
      route !== "local_codex"
        ? fallbackVisionNeed(completeText)
        : "none";
    const ritual: ConversationRitual =
      turnState === "complete" &&
      route !== "silence" &&
      route !== "create_reminder" &&
      route !== "create_file" &&
      route !== "desktop_action" &&
      route !== "desktop_control" &&
      route !== "local_codex"
        ? fallbackConversationRitual(completeText, socialEligibility)
        : "none";
    await recordSocialDecision(
      auth.user.id,
      { ritual, memoryUse: "none" },
      socialEligibility.localDate,
      now,
    ).catch((stateError) =>
      console.error("Social state update failed", stateError),
    );
    return Response.json({
      route,
      turnState,
      responsePosture: fallbackResponsePosture(completeText),
      responseLength: fallbackResponseLength(completeText, replyLength, route),
      memoryUse: "none",
      ritual,
      visionNeed,
      visionBlocked: await reserveVisionIfNeeded(
        auth.user.id,
        visionNeed,
        body.visionAvailable === true,
      ),
      source: "fallback",
    });
  }
}
