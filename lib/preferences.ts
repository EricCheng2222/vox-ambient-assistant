import {
  defaultRealtimeVoice,
  parseRealtimeVoice,
  realtimeVoiceOptions,
  type RealtimeVoice,
} from "@/lib/realtime-voice";
import {
  defaultReplyLength,
  parseReplyLength,
  type ReplyLength,
} from "@/lib/reply-length";

export type Initiative = "off" | "quiet" | "balanced" | "social";

export type UserPreferences = {
  replyLength: ReplyLength;
  voice: RealtimeVoice;
  initiative: Initiative;
};

const initiatives = new Set<Initiative>([
  "off",
  "quiet",
  "balanced",
  "social",
]);
const replyLengths = new Set<ReplyLength>(["less", "balanced", "more"]);
const voices = new Set<string>(realtimeVoiceOptions.map((option) => option.id));

export const defaultInitiative: Initiative = "balanced";

export const defaultUserPreferences: UserPreferences = {
  replyLength: defaultReplyLength,
  voice: defaultRealtimeVoice,
  initiative: defaultInitiative,
};

export function isInitiative(value: unknown): value is Initiative {
  return typeof value === "string" && initiatives.has(value as Initiative);
}

export function isReplyLength(value: unknown): value is ReplyLength {
  return typeof value === "string" && replyLengths.has(value as ReplyLength);
}

export function isRealtimeVoice(value: unknown): value is RealtimeVoice {
  return typeof value === "string" && voices.has(value);
}

export function parseInitiative(value: unknown): Initiative {
  return isInitiative(value) ? value : defaultInitiative;
}

export function parseUserPreferences(value: unknown): UserPreferences {
  const candidate = value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
  return {
    replyLength: parseReplyLength(candidate.replyLength),
    voice: parseRealtimeVoice(candidate.voice),
    initiative: parseInitiative(candidate.initiative),
  };
}
