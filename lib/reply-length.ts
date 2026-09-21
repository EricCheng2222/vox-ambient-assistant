export type ReplyLength = "less" | "balanced" | "more";
export type AdaptiveReplyLength =
  | "minimal"
  | "brief"
  | "standard"
  | "detailed"
  | "expansive";

const REPLY_LENGTHS = new Set<ReplyLength>(["less", "balanced", "more"]);
const ADAPTIVE_REPLY_LENGTHS = new Set<AdaptiveReplyLength>([
  "minimal",
  "brief",
  "standard",
  "detailed",
  "expansive",
]);
const ADAPTIVE_REPLY_LENGTH_ORDER: readonly AdaptiveReplyLength[] = [
  "minimal",
  "brief",
  "standard",
  "detailed",
  "expansive",
];

const ADAPTIVE_CHOICES: Record<ReplyLength, readonly AdaptiveReplyLength[]> = {
  less: ["minimal", "brief", "standard"],
  balanced: ["minimal", "brief", "standard", "detailed"],
  more: ["brief", "standard", "detailed", "expansive"],
};

export const defaultReplyLength: ReplyLength = "balanced";

export function parseReplyLength(value: unknown): ReplyLength {
  return typeof value === "string" && REPLY_LENGTHS.has(value as ReplyLength)
    ? (value as ReplyLength)
    : defaultReplyLength;
}

export function replyLengthInstruction(value: ReplyLength) {
  if (value === "less") {
    return "Response length preference: Less. Loosely mirror how much the user says, then bias the reply about one natural step shorter. Treat this as a concise range, not a fixed sentence count. A complex request may still need enough room to be useful. Do not make every reply the same size.";
  }
  if (value === "more") {
    return "Response length preference: More. Loosely mirror how much the user says, then bias the reply about one natural step fuller with useful explanation, context, or examples. Still allow short acknowledgements and simple answers. Vary length and rhythm with the moment instead of filling a quota.";
  }
  return "Response length preference: Balanced. Loosely mirror the user's conversational scale while still adapting to what the answer needs. Move naturally between a quick reply, a normal explanation, and an occasional detailed answer. Do not force every response toward the same middle length.";
}

export function adaptiveReplyLengthChoices(value: ReplyLength) {
  return ADAPTIVE_CHOICES[value];
}

export function defaultAdaptiveReplyLength(
  value: ReplyLength,
): AdaptiveReplyLength {
  if (value === "less") return "brief";
  if (value === "more") return "detailed";
  return "standard";
}

export function parseAdaptiveReplyLength(
  value: unknown,
  preference: ReplyLength,
): AdaptiveReplyLength {
  if (
    typeof value === "string" &&
    ADAPTIVE_REPLY_LENGTHS.has(value as AdaptiveReplyLength) &&
    ADAPTIVE_CHOICES[preference].includes(value as AdaptiveReplyLength)
  ) {
    return value as AdaptiveReplyLength;
  }
  return defaultAdaptiveReplyLength(preference);
}

export function userTurnLengthSignals(text: string) {
  const trimmed = text.trim();
  const hanCharacters = trimmed.match(/[\u3400-\u9fff]/gu)?.length ?? 0;
  const nonHanText = trimmed.replace(/[\u3400-\u9fff]/gu, " ");
  const nonHanWords =
    nonHanText.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  const sentenceCount = trimmed.match(/[.!?。！？]+/gu)?.length ?? 0;

  return {
    characters: trimmed.length,
    meaningfulUnits: hanCharacters + nonHanWords,
    sentenceCount,
  };
}

export function mirroredAdaptiveReplyLength(
  text: string,
  preference: ReplyLength,
  options: { compact?: boolean } = {},
): AdaptiveReplyLength {
  const choices = adaptiveReplyLengthChoices(preference);
  if (options.compact) return choices[0];

  const { meaningfulUnits, sentenceCount } = userTurnLengthSignals(text);
  let mirroredIndex =
    meaningfulUnits <= 7
      ? 0
      : meaningfulUnits <= 20
        ? 1
        : meaningfulUnits <= 55
          ? 2
          : meaningfulUnits <= 110
            ? 3
            : 4;

  if (sentenceCount >= 4 && mirroredIndex < 3) mirroredIndex += 1;

  const preferenceShift = preference === "less" ? -1 : preference === "more" ? 1 : 0;
  const desiredIndex = Math.max(
    0,
    Math.min(ADAPTIVE_REPLY_LENGTH_ORDER.length - 1, mirroredIndex + preferenceShift),
  );

  return choices.reduce((closest, choice) => {
    const closestDistance = Math.abs(
      ADAPTIVE_REPLY_LENGTH_ORDER.indexOf(closest) - desiredIndex,
    );
    const choiceDistance = Math.abs(
      ADAPTIVE_REPLY_LENGTH_ORDER.indexOf(choice) - desiredIndex,
    );
    return choiceDistance < closestDistance ? choice : closest;
  });
}

export function adaptiveReplyLengthInstruction(
  preference: ReplyLength,
  value: AdaptiveReplyLength,
) {
  const target = parseAdaptiveReplyLength(value, preference);
  const instruction: Record<AdaptiveReplyLength, string> = {
    minimal:
      "For this turn, use a minimal response: a direct phrase or one compact spoken sentence is likely enough.",
    brief:
      "For this turn, be brief: answer directly in a small handful of natural spoken sentences, adding only the most useful detail.",
    standard:
      "For this turn, use a natural standard length: answer clearly with enough explanation to feel complete, without stretching it.",
    detailed:
      "For this turn, give a detailed but conversational answer, developing the useful context and reasoning without repetition.",
    expansive:
      "For this turn, a fuller exploration is appropriate: explain the important reasoning, nuance, or examples while keeping it comfortable to hear aloud.",
  };
  return `${instruction[target]} This target already reflects the user's conversational scale and their saved length preference. It is not an exact word or sentence quota; loosely match the user's rhythm and let the phrasing and cadence vary naturally.`;
}

export function adaptiveReplyLengthSettings(
  value: AdaptiveReplyLength,
  isExpert = false,
) {
  const base = {
    minimal: { verbosity: "low" as const, maxOutputTokens: 320 },
    brief: { verbosity: "low" as const, maxOutputTokens: 650 },
    standard: { verbosity: "medium" as const, maxOutputTokens: 1100 },
    detailed: { verbosity: "high" as const, maxOutputTokens: 2100 },
    expansive: { verbosity: "high" as const, maxOutputTokens: 3200 },
  }[value];

  return {
    ...base,
    maxOutputTokens: isExpert
      ? Math.min(3600, Math.round(base.maxOutputTokens * 1.35))
      : base.maxOutputTokens,
  };
}
