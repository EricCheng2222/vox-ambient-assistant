export type ConversationRole = "user" | "assistant";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  text: string;
};

export function isConversationRole(value: unknown): value is ConversationRole {
  return value === "user" || value === "assistant";
}
