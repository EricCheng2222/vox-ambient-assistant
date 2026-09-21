export const realtimeVoiceOptions = [
  { id: "marin", label: "Marin" },
  { id: "cedar", label: "Cedar" },
  { id: "alloy", label: "Alloy" },
  { id: "ash", label: "Ash" },
  { id: "ballad", label: "Ballad" },
  { id: "coral", label: "Coral" },
  { id: "echo", label: "Echo" },
  { id: "sage", label: "Sage" },
  { id: "shimmer", label: "Shimmer" },
  { id: "verse", label: "Verse" },
] as const;

export type RealtimeVoice = (typeof realtimeVoiceOptions)[number]["id"];

export const defaultRealtimeVoice: RealtimeVoice = "marin";

const realtimeVoiceIds = new Set<string>(
  realtimeVoiceOptions.map((voice) => voice.id),
);

export function parseRealtimeVoice(value: unknown): RealtimeVoice {
  return typeof value === "string" && realtimeVoiceIds.has(value)
    ? (value as RealtimeVoice)
    : defaultRealtimeVoice;
}
