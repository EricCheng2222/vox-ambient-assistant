export type ConversationRole = "user" | "assistant";
export type ConversationSource = "local" | "phone";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  text: string;
  source?: ConversationSource;
};

export function isConversationRole(value: unknown): value is ConversationRole {
  return value === "user" || value === "assistant";
}

export function isConversationSource(value: unknown): value is ConversationSource {
  return value === "local" || value === "phone";
}
