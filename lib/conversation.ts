export type ConversationRole = "user" | "assistant";
/**
 * "sms": a text someone sent to the Vox phone number. "caller": a line from a
 * call Vox answered for an unverified caller ("user" is the caller, "assistant"
 * is Vox talking to them).
 */
export type ConversationSource = "local" | "phone" | "sms" | "caller";

export type ConversationMessage = {
  id: string;
  role: ConversationRole;
  text: string;
  source?: ConversationSource;
  /** For "sms" and "caller": the other person's phone number. */
  sender?: string;
  /** For "sms" and "caller": marked read by the owner, on any device. */
  read?: boolean;
};

export function isConversationRole(value: unknown): value is ConversationRole {
  return value === "user" || value === "assistant";
}

/** Sources a signed-in client may set; only the Twilio webhook adds texts. */
export function isConversationSource(value: unknown): value is "local" | "phone" {
  return value === "local" || value === "phone";
}
