import { forwardSubject, type OutgoingMessage, quoteOriginal, replyRecipients, replyReferences, replySubject } from "../mime.ts";
import type { Compose, FullMessage } from "./types.ts";

// Replies and forwards built as MIME, shared by the providers that send raw
// messages (Gmail and SMTP). Microsoft Graph uses its own reply endpoints.

const QUOTE_LIMIT = 20_000;

function quoted(original: FullMessage) {
  const body = original.body.length > QUOTE_LIMIT ? `${original.body.slice(0, QUOTE_LIMIT)}\n[…]` : original.body;
  return quoteOriginal(original.date, original.from, body || "(no text)");
}

/** A threaded reply: recipients, "Re:" subject, In-Reply-To/References, and the quoted original. */
export function replyMessage(original: FullMessage, self: string, body: string, replyAll: boolean): OutgoingMessage {
  const { to, cc } = replyRecipients(original, self, replyAll);
  return {
    to,
    cc,
    subject: replySubject(original.subject),
    body: `${body}\n\n${quoted(original)}`,
    inReplyTo: original.messageId,
    references: replyReferences(original.references, original.messageId),
  };
}

/** A reply draft: the user's own fields win over the reply's defaults. */
export function replyDraft(original: FullMessage, self: string, input: Compose): OutgoingMessage {
  const reply = replyMessage(original, self, input.body, false);
  return {
    ...reply,
    to: input.to.length ? input.to : reply.to,
    cc: input.cc.length ? input.cc : [],
    bcc: input.bcc,
    subject: input.subject.trim() || reply.subject,
  };
}

/** The body of a forward: the note, then the original's headers and text. */
export function forwardBody(original: FullMessage, note: string) {
  const forwarded = [
    "---------- Forwarded message ---------",
    `From: ${original.from}`,
    `Date: ${original.date}`,
    `Subject: ${original.subject}`,
    `To: ${original.to}`,
    ...(original.cc ? [`Cc: ${original.cc}`] : []),
    "",
    original.body || "(no text)",
  ].join("\n");
  return { subject: forwardSubject(original.subject), body: note ? `${note}\n\n${forwarded}` : forwarded };
}

// Attachments forwarded along with an email, at most (Gmail's limit is 25 MB).
export const FORWARD_ATTACHMENT_LIMIT = 18 * 1024 * 1024;
