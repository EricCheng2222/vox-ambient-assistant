export type ReplyLength = "less" | "balanced" | "more";

const REPLY_LENGTHS = new Set<ReplyLength>(["less", "balanced", "more"]);

export const defaultReplyLength: ReplyLength = "balanced";

export function parseReplyLength(value: unknown): ReplyLength {
  return typeof value === "string" && REPLY_LENGTHS.has(value as ReplyLength)
    ? (value as ReplyLength)
    : defaultReplyLength;
}

export function replyLengthInstruction(value: ReplyLength) {
  if (value === "less") {
    return "Response length preference: Less. Give the shortest natural answer that is still useful, usually one or two spoken sentences. Do not add background detail unless it is necessary.";
  }
  if (value === "more") {
    return "Response length preference: More. Give a fuller conversational answer with helpful explanation, context, and examples when relevant, while still sounding natural when spoken aloud.";
  }
  return "Response length preference: Balanced. Give a moderately detailed answer that addresses the request clearly without becoming repetitive or overly long.";
}
