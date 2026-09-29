import { bytesToBase64, bytesToBase64Url } from "./util.ts";

// Builds RFC 5322 / MIME messages for Gmail's `raw` field: UTF-8 bodies in
// base64, RFC 2047 encoded headers (so Chinese subjects and names survive),
// and the In-Reply-To / References headers that keep replies threaded.

export type Address = { name: string; email: string };
export type Attachment = { filename: string; mimeType: string; data: Uint8Array };

export class AddressError extends Error {}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/u;

/** Header values never carry line breaks from user input (no header injection). */
function oneLine(value: string) {
  return value.replace(/[\r\n\t]+/gu, " ").trim();
}

/** Splits "A <a@x.com>, "B, Jr." <b@x.com>; c@x.com" into addresses. */
export function parseAddressList(value: string): Address[] {
  const pieces: string[] = [];
  let current = "";
  let quoted = false;
  let angle = false;
  for (const character of oneLine(value)) {
    if (character === '"') quoted = !quoted;
    else if (character === "<" && !quoted) angle = true;
    else if (character === ">" && !quoted) angle = false;
    if ((character === "," || character === ";") && !quoted && !angle) {
      pieces.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  pieces.push(current);
  const addresses: Address[] = [];
  for (const piece of pieces.map((item) => item.trim()).filter(Boolean)) {
    const match = /^(.*?)\s*<([^<>]*)>\s*$/u.exec(piece);
    const name = (match ? match[1] : "").trim().replace(/^"(.*)"$/u, "$1").replace(/\\(.)/gu, "$1").trim();
    addresses.push({ name, email: (match ? match[2] : piece).trim() });
  }
  return addresses;
}

/** Parses addresses the user gave and rejects anything that isn't an email address. */
export function requireAddresses(value: unknown, field: string): Address[] {
  const list = Array.isArray(value) ? value.filter((item) => typeof item === "string").join(", ") : typeof value === "string" ? value : "";
  const addresses = parseAddressList(list);
  for (const address of addresses) {
    if (!EMAIL.test(address.email)) throw new AddressError(`"${address.email || address.name}" in ${field} is not an email address.`);
  }
  if (addresses.length > 50) throw new AddressError(`Too many addresses in ${field}.`);
  return addresses;
}

export function uniqueAddresses(addresses: Address[], exclude: string[] = []) {
  const seen = new Set(exclude.map((email) => email.toLowerCase()));
  return addresses.filter((address) => {
    const key = address.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const ASCII_TEXT = /^[\x20-\x7e]*$/u;

/**
 * RFC 2047 "B" encoded words, each at most 75 characters, split between
 * characters (never inside one), folded onto continuation lines.
 */
export function encodeHeaderText(value: string) {
  const text = oneLine(value);
  if (ASCII_TEXT.test(text)) return text;
  const encoder = new TextEncoder();
  const words: string[] = [];
  let chunk: number[] = [];
  for (const character of text) {
    const bytes = encoder.encode(character);
    if (chunk.length + bytes.length > 45) {
      words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
      chunk = [];
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(`=?UTF-8?B?${bytesToBase64(Uint8Array.from(chunk))}?=`);
  return words.join("\r\n ");
}

export function formatAddress(address: Address) {
  const name = oneLine(address.name);
  if (!name) return address.email;
  if (!ASCII_TEXT.test(name)) return `${encodeHeaderText(name)} <${address.email}>`;
  if (/^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]+$/u.test(name)) return `${name} <${address.email}>`;
  return `"${name.replace(/(["\\])/gu, "\\$1")}" <${address.email}>`;
}

export function formatAddressList(addresses: Address[]) {
  return addresses.map(formatAddress).join(",\r\n ");
}

/** Decodes RFC 2047 encoded words in a header value, for display. */
export function decodeHeaderText(value: string) {
  return value
    .replace(/(=\?[^?\s]+\?[bBqQ]\?[^?\s]*\?=)\s+(?==\?)/gu, "$1")
    .replace(/=\?([^?\s]+)\?([bBqQ])\?([^?\s]*)\?=/gu, (word, charset: string, kind: string, data: string) => {
      try {
        const bytes =
          kind.toUpperCase() === "B"
            ? Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
            : Uint8Array.from(
                data.replace(/_/gu, " ").replace(/=([0-9A-Fa-f]{2})|[\s\S]/gu, (match, hex: string | undefined) =>
                  hex ? String.fromCharCode(parseInt(hex, 16)) : match,
                ),
                (character) => character.charCodeAt(0),
              );
        return new TextDecoder(charset.replace(/\*.*$/u, "")).decode(bytes);
      } catch {
        return word;
      }
    });
}

/** "Re: …" unless the subject already starts with a reply prefix. */
export function replySubject(subject: string) {
  const trimmed = oneLine(subject);
  return /^(re|aw|sv|回覆|回复|答复)\s*(\[\d+\])?\s*[:：]/iu.test(trimmed) ? trimmed : `Re: ${trimmed}`.trim();
}

export function forwardSubject(subject: string) {
  const trimmed = oneLine(subject);
  return /^(fwd?|fw|wg|轉寄|转发)\s*[:：]/iu.test(trimmed) ? trimmed : `Fwd: ${trimmed}`.trim();
}

/** The References chain for a reply: the original's chain plus its Message-ID. */
export function replyReferences(references: string, messageId: string) {
  const ids: string[] = [...(references.match(/<[^<>\s]+>/gu) ?? [])];
  const own = messageId.match(/<[^<>\s]+>/u)?.[0];
  if (own && !ids.includes(own)) ids.push(own);
  // Keep the thread root plus the most recent ids, as RFC 5322 suggests.
  return (ids.length > 20 ? [ids[0], ...ids.slice(-19)] : ids).join(" ");
}

/** Who a reply goes to. A reply to your own sent mail goes to its recipients. */
export function replyRecipients(
  original: { from: string; replyTo: string; to: string; cc: string },
  self: string,
  replyAll: boolean,
) {
  const me = self.toLowerCase();
  const sender = parseAddressList(original.replyTo || original.from);
  const sentByMe = parseAddressList(original.from).some((address) => address.email.toLowerCase() === me);
  const originalTo = parseAddressList(original.to);
  let to = uniqueAddresses(sentByMe ? originalTo : sender, [me]);
  if (!to.length) to = uniqueAddresses(sender);
  const cc = replyAll
    ? uniqueAddresses([...(sentByMe ? [] : originalTo), ...parseAddressList(original.cc)], [me, ...to.map((address) => address.email)])
    : [];
  return { to, cc };
}

/** Quotes the original body under an attribution line. */
export function quoteOriginal(date: string, from: string, body: string) {
  const quoted = body.trim().split(/\r?\n/u).map((line) => (line ? `> ${line}` : ">")).join("\n");
  return `On ${oneLine(date) || "an earlier date"}, ${oneLine(from) || "the sender"} wrote:\n${quoted}`;
}

function wrapBase64(value: string) {
  return value.replace(/.{1,76}/gu, "$&\r\n");
}

function utf8Base64(text: string) {
  return wrapBase64(bytesToBase64(new TextEncoder().encode(text.replace(/\r?\n/gu, "\r\n"))));
}

/** RFC 2231 filename parameter, so non-ASCII attachment names survive. */
function filenameParameter(key: string, filename: string) {
  const name = oneLine(filename).replace(/["\\]/gu, "_") || "attachment";
  if (ASCII_TEXT.test(name)) return `${key}="${name}"`;
  const encoded = encodeURIComponent(name).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${key}*=UTF-8''${encoded}`;
}

export type OutgoingMessage = {
  // Gmail and Graph fill in From, Date, and Message-ID themselves; SMTP needs them.
  from?: Address;
  date?: Date;
  messageId?: string;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: Attachment[];
};

/** RFC 5322 date, e.g. "Tue, 29 Sep 2026 04:33:00 +0000". */
export function formatMailDate(date: Date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${days[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

/** A new Message-ID in the sender's domain. */
export function newMessageId(email: string) {
  const domain = /@([^\s@>]+)$/u.exec(email)?.[1] ?? "vox-mail.local";
  return `<${crypto.randomUUID()}@${domain}>`;
}

/**
 * The whole message as ASCII text with CRLF line endings. `omitBcc` leaves
 * out the Bcc header, for the copy handed to SMTP.
 */
export function buildMessage(message: OutgoingMessage, options: { omitBcc?: boolean } = {}) {
  const headers: string[] = [];
  if (message.from) headers.push(`From: ${formatAddress(message.from)}`);
  if (message.date) headers.push(`Date: ${formatMailDate(message.date)}`);
  if (message.messageId) headers.push(`Message-ID: ${message.messageId}`);
  if (message.to.length) headers.push(`To: ${formatAddressList(message.to)}`);
  if (message.cc?.length) headers.push(`Cc: ${formatAddressList(message.cc)}`);
  // Gmail removes Bcc from what recipients see and delivers to these addresses.
  if (message.bcc?.length && !options.omitBcc) headers.push(`Bcc: ${formatAddressList(message.bcc)}`);
  headers.push(`Subject: ${encodeHeaderText(message.subject.slice(0, 900))}`);
  const inReplyTo = message.inReplyTo?.match(/<[^<>\s]+>/u)?.[0];
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (message.references) headers.push(`References: ${oneLine(message.references).split(" ").join("\r\n ")}`);
  headers.push("MIME-Version: 1.0");
  const text = ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "", utf8Base64(message.body)];
  if (!message.attachments?.length) return [...headers, ...text].join("\r\n");
  const boundary = `vox-mail-${crypto.randomUUID()}`;
  const parts = [`--${boundary}`, ...text];
  for (const attachment of message.attachments) {
    const type = /^[\w.+-]+\/[\w.+-]+$/u.test(attachment.mimeType) ? attachment.mimeType : "application/octet-stream";
    parts.push(
      `--${boundary}`,
      `Content-Type: ${type}; ${filenameParameter("name", attachment.filename)}`,
      `Content-Disposition: attachment; ${filenameParameter("filename", attachment.filename)}`,
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(bytesToBase64(attachment.data)),
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
}

/** Gmail's `raw` field: the message, base64url encoded. */
export function toRaw(message: string) {
  return bytesToBase64Url(new TextEncoder().encode(message));
}
