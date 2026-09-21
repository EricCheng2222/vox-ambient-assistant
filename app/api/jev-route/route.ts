type JevRoute =
  | "silence"
  | "realtime"
  | "balanced_reasoning"
  | "expert_reasoning"
  | "live_web";

const ROUTES = new Set<JevRoute>([
  "silence",
  "realtime",
  "balanced_reasoning",
  "expert_reasoning",
  "live_web",
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
        state: { utterance: text },
        questions: {
          route: {
            type: "choice",
            instructions:
              "Route this utterance for an ambient voice assistant. Choose silence when the speech is incidental, filler, background conversation, not directed at the assistant, or explicitly asks for no reply. Choose realtime for greetings, casual conversation, simple stable facts, and brief clarifications. Choose balanced_reasoning for multi-step analysis, comparisons, planning, or nuanced explanations. Choose expert_reasoning only for exceptionally difficult, high-stakes, or deeply technical work where maximum accuracy matters. Choose live_web when the answer depends on current, recent, changing, or location-specific information.",
            criteria: {
              silence: "The assistant should not speak.",
              realtime: "Use the low-latency realtime voice model.",
              balanced_reasoning: "Use the balanced reasoning model.",
              expert_reasoning: "Use the most capable expert reasoning model.",
              live_web: "Use a model with live web search.",
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
