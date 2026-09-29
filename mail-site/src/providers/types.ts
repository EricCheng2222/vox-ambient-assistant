import type { Address, OutgoingMessage } from "../mime.ts";

// One interface over Gmail, Microsoft Graph, and IMAP + SMTP. Ids here are
// the provider's own; mcp.ts wraps them in account-qualified ids.

export type MessageSummary = {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  /** Milliseconds since the epoch, for merging accounts by date. */
  time: number;
  snippet: string;
  /** Labels, folders, or categories to show (not UNREAD). */
  labels: string[];
  unread: boolean;
};

export type AttachmentSummary = { filename: string; mimeType: string; size: number };

export type FullMessage = MessageSummary & {
  body: string;
  attachments: AttachmentSummary[];
  replyTo: string;
  messageId: string;
  references: string;
};

export type Compose = { to: Address[]; cc: Address[]; bcc: Address[]; subject: string; body: string };

export type SearchPage = { messages: MessageSummary[]; next?: string };

export type ChangeResult = { id: string; ok: boolean; error?: string; newId?: string };

export interface MailProvider {
  readonly email: string;
  /** Searches with Gmail-style syntax (translated for other providers). */
  search(query: string, max: number, pageToken?: string): Promise<SearchPage>;
  read(id: string): Promise<FullMessage>;
  thread(id: string): Promise<FullMessage[]>;
  folders(): Promise<{ kind: string; system: string[]; own: string[] }>;
  unread(max: number): Promise<{ count: number; latest: MessageSummary[] }>;
  /** Saves a draft; with replyToId it's a threaded reply and empty fields default to the reply's. */
  createDraft(input: Compose, replyToId?: string): Promise<{ id: string; to: Address[]; cc: Address[]; bcc: Address[]; subject: string }>;
  send(input: Compose): Promise<{ id?: string }>;
  reply(id: string, body: string, replyAll: boolean): Promise<{ to: Address[]; cc: Address[]; subject: string; id?: string }>;
  forward(id: string, to: Address[], note: string): Promise<{ subject: string; attachments: number; skippedBytes: number }>;
  sendDraft(id: string): Promise<{ to: string; subject: string }>;
  modify(ids: string[], add: string[], remove: string[]): Promise<{ added: string[]; removed: string[] }>;
  trash(ids: string[]): Promise<ChangeResult[]>;
  untrash(ids: string[]): Promise<ChangeResult[]>;
  /** False when the account needs reconnecting. Only checks what's cheap to check. */
  check?(): Promise<boolean>;
  close?(): Promise<void>;
}

export type { Address, OutgoingMessage };
