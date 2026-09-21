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
    return "Response length preference: Less. Treat this as a concise range, not a fixed sentence count. A tiny social response may be only a phrase, a normal answer may be a few spoken sentences, and a genuinely complex request may run a little longer when usefulness requires it. Do not make every reply the same size.";
  }
  if (value === "more") {
    return "Response length preference: More. Usually give a fuller conversational answer with helpful explanation, context, or examples, but still allow naturally short acknowledgements and simple answers. Vary length and rhythm with the moment instead of filling a quota.";
  }
  return "Response length preference: Balanced. Move naturally between a quick reply, a normal explanation, and an occasional detailed answer according to the moment. Do not force every response toward the same middle length.";
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
  return `${instruction[target]} This is a flexible target for this particular reply, not an exact word or sentence quota; let the phrasing and cadence vary naturally.`;
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
