import { requireAuthorized } from "@/lib/auth";
import { getCurrentTimeContext } from "@/lib/time-context";

type Initiative = "off" | "quiet" | "balanced" | "social";
type PresenceAction = "stay_silent" | "check_in" | "continue_topic";

type RecentMessage = {
  role: "user" | "assistant";
  text: string;
};

const INITIATIVES = new Set<Initiative>(["off", "quiet", "balanced", "social"]);
const ACTIONS = new Set<PresenceAction>([
  "stay_silent",
  "check_in",
  "continue_topic",
]);

function fallbackAction(
  initiative: Initiative,
  quietForMs: number,
  sinceAssistantMs: number,
  recentMessages: RecentMessage[],
): PresenceAction {
  if (initiative === "off") return "stay_silent";

  const threshold =
    initiative === "social" ? 45_000 : initiative === "balanced" ? 120_000 : 300_000;
  if (quietForMs < threshold || sinceAssistantMs < threshold) return "stay_silent";

  return recentMessages.length > 0 ? "continue_topic" : "check_in";
}

export async function POST(request: Request) {
  const unauthorized = await requireAuthorized(request);
  if (unauthorized) return unauthorized;

  const body = (await request.json().catch(() => ({}))) as {
    initiative?: Initiative;
    quietForMs?: number;
    sinceAssistantMs?: number;
    proactiveCount?: number;
    recentMessages?: RecentMessage[];
  };

  const initiative = INITIATIVES.has(body.initiative ?? "balanced")
    ? (body.initiative ?? "balanced")
    : "balanced";
  const quietForMs = Math.max(0, Number(body.quietForMs) || 0);
  const sinceAssistantMs = Math.max(0, Number(body.sinceAssistantMs) || 0);
  const proactiveCount = Math.max(0, Number(body.proactiveCount) || 0);
  const recentMessages = Array.isArray(body.recentMessages)
    ? body.recentMessages
        .filter(
          (message): message is RecentMessage =>
            (message?.role === "user" || message?.role === "assistant") &&
            typeof message?.text === "string",
        )
        .slice(-6)
        .map((message) => ({ ...message, text: message.text.slice(0, 1000) }))
    : [];

  if (initiative === "off" || proactiveCount >= 6) {
    return Response.json({ action: "stay_silent", source: "guardrail" });
  }

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    return Response.json({
      action: fallbackAction(initiative, quietForMs, sinceAssistantMs, recentMessages),
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
          initiative,
          quiet_seconds: Math.round(quietForMs / 1000),
          seconds_since_assistant: Math.round(sinceAssistantMs / 1000),
          proactive_count: proactiveCount,
          current_time: getCurrentTimeContext(),
          recent_conversation: recentMessages,
        },
        questions: {
          timing: {
            type: "choice",
            instructions:
              "Decide whether an ambient voice companion should speak first right now. Strongly prefer silence. Never speak merely because a timer elapsed. Speak only when a short contribution would feel socially natural and clearly useful: continuing an unfinished topic, surfacing a relevant next step, or offering a gentle check-in after meaningful quiet. Avoid nagging, repetition, filler, or interrupting focused silence. Interpret quiet as low initiative, balanced as moderate initiative, and social as higher initiative, while still requiring a reason to talk.",
            criteria: {
              stay_silent: "There is no clearly useful or natural reason to speak now.",
              check_in: "A short, warm check-in would be welcome and not intrusive.",
              continue_topic:
                "A concise follow-up grounded in the recent conversation would add value now.",
            },
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Jev returned ${response.status}`);
    const payload = (await response.json()) as {
      answers?: { timing?: { choice?: string; confidence?: number } };
    };
    const action = payload.answers?.timing?.choice as PresenceAction | undefined;
    if (!action || !ACTIONS.has(action)) throw new Error("Invalid Jev presence action");

    return Response.json({
      action,
      confidence: payload.answers?.timing?.confidence ?? null,
      source: "jev",
    });
  } catch (error) {
    console.error("Jev presence decision failed", error);
    return Response.json({
      action: fallbackAction(initiative, quietForMs, sinceAssistantMs, recentMessages),
      source: "fallback",
    });
  }
}
