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

const ROUTES = new Set<JevRoute>([
  "silence",
  "realtime",
  "balanced_reasoning",
  "expert_reasoning",
  "live_web",
  "create_reminder",
  "create_file",
]);

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

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const text = body.text?.trim().slice(0, 6000) ?? "";
  if (!text) return Response.json({ route: "silence", source: "fallback" });

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    return Response.json({ route: fallbackRoute(text), source: "fallback" });
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
          utterance: text,
          authoritative_clock: getCurrentTimeContext(),
        },
        questions: {
          route: {
            type: "choice",
            instructions:
              "Route this utterance for an ambient voice assistant. Choose silence when the speech is incidental, filler, background conversation, not directed at the assistant, or explicitly asks for no reply. Choose create_reminder only when the user explicitly asks to be reminded or notified at a future time. Choose create_file only when the user explicitly wants the assistant to produce or save a downloadable file, document, checklist, report, table, data file, web page, or source-code file. Choose realtime for greetings, casual conversation, simple stable facts, brief clarifications, and questions about the current local time, date, or weekday because an authoritative clock is provided. Choose balanced_reasoning for multi-step analysis, comparisons, planning, or nuanced explanations that should be spoken rather than saved as a file. Choose expert_reasoning only for exceptionally difficult, high-stakes, or deeply technical work where maximum accuracy matters. Choose live_web when the answer depends on current, recent, changing, or location-specific information other than the supplied local time and date.",
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
        },
      }),
    });

    if (!response.ok) throw new Error(`Jev returned ${response.status}`);
    const payload = (await response.json()) as {
      answers?: { route?: { choice?: string; confidence?: number } };
    };
    const choice = payload.answers?.route?.choice as JevRoute | undefined;
    if (!choice || !ROUTES.has(choice)) throw new Error("Invalid Jev route");

    return Response.json({
      route: choice,
      confidence: payload.answers?.route?.confidence ?? null,
      source: "jev",
    });
  } catch (error) {
    console.error("Jev routing failed", error);
    return Response.json({ route: fallbackRoute(text), source: "fallback" });
  }
}
