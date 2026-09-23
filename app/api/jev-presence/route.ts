import { requireUser } from "@/lib/auth";
import { boundedRecentMessages } from "@/lib/conversation-context";
import { listMemories } from "@/lib/memory-store";
import { getSocialEligibility, recordSocialDecision } from "@/lib/social-state-store";
import { getCurrentTimeContext } from "@/lib/time-context";

type Initiative = "off" | "quiet" | "balanced" | "social";
type PresenceAction =
  | "stay_silent"
  | "check_in"
  | "continue_topic"
  | "natural_callback"
  | "emotional_followup"
  | "morning_hello";

type RecentMessage = {
  role: "user" | "assistant";
  text: string;
};

const INITIATIVES = new Set<Initiative>(["off", "quiet", "balanced", "social"]);
const ACTIONS = new Set<PresenceAction>([
  "stay_silent",
  "check_in",
  "continue_topic",
  "natural_callback",
  "emotional_followup",
  "morning_hello",
]);

function fallbackAction(
  initiative: Initiative,
  quietForMs: number,
  sinceAssistantMs: number,
  recentMessages: RecentMessage[],
  morningAvailable: boolean,
): PresenceAction {
  if (initiative === "off") return "stay_silent";

  const threshold =
    initiative === "social" ? 45_000 : initiative === "balanced" ? 120_000 : 300_000;
  if (quietForMs < threshold || sinceAssistantMs < threshold) return "stay_silent";

  if (morningAvailable && recentMessages.length === 0) return "morning_hello";

  return recentMessages.length > 0 ? "continue_topic" : "check_in";
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;

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
    ? boundedRecentMessages(
        body.recentMessages.filter(
          (message): message is RecentMessage =>
            (message?.role === "user" || message?.role === "assistant") &&
            typeof message?.text === "string",
        ),
      )
    : [];

  if (initiative === "off" || proactiveCount >= 6) {
    return Response.json({ action: "stay_silent", source: "guardrail" });
  }

  const now = new Date();
  const [memories, socialEligibility] = await Promise.all([
    listMemories(auth.user.id, 8).catch((error) => {
      console.error("Jev presence without saved memory", error);
      return [];
    }),
    getSocialEligibility(auth.user.id, now).catch((error) => {
      console.error("Jev presence without social state", error);
      return {
        localDate: "",
        localHour: -1,
        morning: false,
        night: false,
        naturalCallback: false,
        emotionalFollowup: false,
      };
    }),
  ]);

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    const action = fallbackAction(
      initiative,
      quietForMs,
      sinceAssistantMs,
      recentMessages,
      socialEligibility.morning,
    );
    if (action === "morning_hello") {
      await recordSocialDecision(
        auth.user.id,
        { ritual: "good_morning", memoryUse: "none" },
        socialEligibility.localDate,
        now,
      ).catch((error) => console.error("Social state update failed", error));
    }
    return Response.json({
      action,
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
          remembered_context: memories.map((memory) => ({
            id: memory.id,
            category: memory.category,
            content: memory.content.slice(0, 280),
            updated_at: memory.updatedAt,
          })),
          social_eligibility: {
            local_hour: socialEligibility.localHour,
            good_morning_available: socialEligibility.morning,
            natural_callback_available: socialEligibility.naturalCallback,
            emotional_followup_available: socialEligibility.emotionalFollowup,
          },
        },
        questions: {
          timing: {
            type: "choice",
            instructions:
              "Decide whether an ambient voice companion should speak first right now. Strongly prefer silence. Never speak merely because a timer elapsed. Speak only when a short contribution would feel socially natural and clearly welcome. Continue a topic only when there is a concrete unfinished thread. Choose natural_callback only when one saved detail is directly relevant and the cooldown is available. Choose emotional_followup only when one saved unresolved feeling is directly relevant, the moment is calm and unhurried, and the cooldown is available. Choose morning_hello only when it is available, this is the first meaningful local-morning interaction, and a greeting would not interrupt focused silence. Avoid nagging, repetition, filler, demonstrating memory, or interrupting concentration. Interpret quiet as low initiative, balanced as moderate initiative, and social as higher initiative, while still requiring a real reason to talk.",
            criteria: {
              stay_silent: "There is no clearly useful or natural reason to speak now.",
              check_in: "A short, warm check-in would be welcome and not intrusive.",
              continue_topic:
                "A concise follow-up grounded in the recent conversation would add value now.",
              natural_callback:
                "One directly relevant remembered detail would feel like an effortless, welcome callback now.",
              emotional_followup:
                "A gentle, tentative follow-up to one directly relevant unresolved feeling would be welcome now.",
              morning_hello:
                "A brief first-interaction good-morning greeting would feel natural now.",
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

    if (
      (action === "morning_hello" && !socialEligibility.morning) ||
      (action === "natural_callback" && !socialEligibility.naturalCallback) ||
      (action === "emotional_followup" && !socialEligibility.emotionalFollowup)
    ) {
      return Response.json({ action: "stay_silent", source: "guardrail" });
    }

    await recordSocialDecision(
      auth.user.id,
      {
        ritual: action === "morning_hello" ? "good_morning" : "none",
        memoryUse:
          action === "natural_callback" || action === "emotional_followup"
            ? action
            : "none",
      },
      socialEligibility.localDate,
      now,
    ).catch((error) => console.error("Social state update failed", error));

    return Response.json({
      action,
      confidence: payload.answers?.timing?.confidence ?? null,
      source: "jev",
    });
  } catch (error) {
    console.error("Jev presence decision failed", error);
    const action = fallbackAction(
      initiative,
      quietForMs,
      sinceAssistantMs,
      recentMessages,
      socialEligibility.morning,
    );
    if (action === "morning_hello") {
      await recordSocialDecision(
        auth.user.id,
        { ritual: "good_morning", memoryUse: "none" },
        socialEligibility.localDate,
        now,
      ).catch((stateError) =>
        console.error("Social state update failed", stateError),
      );
    }
    return Response.json({
      action,
      source: "fallback",
    });
  }
}
