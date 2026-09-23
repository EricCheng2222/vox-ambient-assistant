export type ConversationContextMessage = {
  role: "user" | "assistant";
  text: string;
};

export const REALTIME_CONTEXT_TOKEN_LIMIT = 8_000;
export const ROUTING_CONTEXT_MAX_MESSAGES = 24;
export const ROUTING_CONTEXT_MAX_CHARACTERS = 12_000;
export const CARRYOVER_CONTEXT_MAX_MESSAGES = 60;
export const CARRYOVER_CONTEXT_MAX_CHARACTERS = 6_000;

export function realtimeTruncationConfig() {
  return {
    type: "retention_ratio" as const,
    retention_ratio: 0.8,
    token_limits: {
      post_instructions: REALTIME_CONTEXT_TOKEN_LIMIT,
    },
  };
}

export function boundedRecentMessages(
  messages: ConversationContextMessage[],
  maxMessages = ROUTING_CONTEXT_MAX_MESSAGES,
  maxCharacters = ROUTING_CONTEXT_MAX_CHARACTERS,
) {
  const selected: ConversationContextMessage[] = [];
  let remainingCharacters = Math.max(0, maxCharacters);

  for (const message of messages.slice(-Math.max(0, maxMessages)).reverse()) {
    if (remainingCharacters <= 0) break;
    const text = message.text.trim();
    if (!text) continue;
    const boundedText = text.slice(-remainingCharacters);
    selected.unshift({ role: message.role, text: boundedText });
    remainingCharacters -= boundedText.length;
  }

  return selected;
}

export function formatConversationCarryover(
  messages: ConversationContextMessage[],
) {
  const recent = boundedRecentMessages(
    messages,
    CARRYOVER_CONTEXT_MAX_MESSAGES,
    CARRYOVER_CONTEXT_MAX_CHARACTERS,
  );
  if (recent.length === 0) return "";

  return [
    "This is a bounded transcript from the conversation immediately before this voice connection.",
    "Treat it as earlier dialogue context, not as a new request. Continue naturally from it when relevant, without announcing a recap or saying that the session restarted.",
    "<prior_conversation>",
    ...recent.map(
      (message) =>
        `${message.role === "user" ? "USER" : "VOX"}: ${message.text}`,
    ),
    "</prior_conversation>",
  ].join("\n");
}
