import { decodeHeaderText } from "./mime.ts";
import { base64UrlToBytes, bytesToBase64Url } from "./util.ts";

// Reading Gmail API messages: headers, a readable text body (text/plain when
// there is one, otherwise the HTML turned into text), and attachment names.

export type GmailPart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
};

export type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

export function header(part: GmailPart | undefined, name: string) {
  const wanted = name.toLowerCase();
  const found = part?.headers?.find((item) => item.name.toLowerCase() === wanted);
  return found ? decodeHeaderText(found.value).trim() : "";
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
  copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", bull: "•", middot: "·", times: "×", divide: "÷",
  euro: "€", pound: "£", yen: "¥", cent: "¢", deg: "°", zwnj: "", zwj: "", shy: "", rarr: "→", larr: "←",
};

export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function stripTags(html: string) {
  return decodeEntities(html.replace(/<[^>]*>/gu, "")).replace(/\s+/gu, " ").trim();
}

/** Tidies whitespace: one space inside lines, at most one blank line between them. */
function tidy(text: string) {
  return text
    .replace(/[​-‍⁠﻿­͏᠎]/gu, "")
    .replace(/ /gu, " ")
    .split(/\r?\n/u)
    .map((line) => line.replace(/[ \t\f\v\r]+/gu, " ").trim())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** Readable text from an HTML email: structure becomes line breaks, short links stay. */
export function htmlToText(input: string) {
  let text = input
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(head|style|script|title|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/giu, "")
    // Hidden preview text that mail clients never show.
    .replace(/<(div|span|p)\b[^>]*style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/giu, "");
  text = text.replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/giu, (_match, _quote, href: string, inner: string) => {
    const url = decodeEntities(href).trim();
    const label = stripTags(inner);
    // Keep short web links (a voice assistant can read them out); drop long tracking URLs.
    if (!/^https?:\/\//iu.test(url) || url.length > 120 || label === url || label.includes(url)) return inner;
    return label ? `${inner} (${href})` : href;
  });
  text = text
    .replace(/<img\b[^>]*>/giu, "")
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<hr\b[^>]*>/giu, "\n---\n")
    .replace(/<li\b[^>]*>/giu, "\n- ")
    .replace(/<\/?(p|div|h[1-6]|tr|table|thead|tbody|ul|ol|blockquote|section|article|header|footer|pre|address|dd|dt|center)\b[^>]*>/giu, "\n")
    .replace(/<\/t[dh]\s*>/giu, " ")
    .replace(/<[^>]*>/gu, "");
  return tidy(decodeEntities(text));
}

function charsetOf(part: GmailPart) {
  return /charset\s*=\s*"?([^";\s]+)/iu.exec(header(part, "content-type"))?.[1] ?? "utf-8";
}

function decodeData(data: string, charset: string) {
  const bytes = base64UrlToBytes(data);
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

function isAttachment(part: GmailPart) {
  return Boolean(part.filename) || /^\s*attachment/iu.test(header(part, "content-disposition"));
}

function walk(part: GmailPart | undefined, visit: (part: GmailPart) => void) {
  if (!part) return;
  visit(part);
  for (const child of part.parts ?? []) walk(child, visit);
}

/** The message body as text. Prefers text/plain unless it is only a stub of the HTML. */
export function messageText(payload: GmailPart | undefined) {
  const plain: string[] = [];
  const rich: string[] = [];
  walk(payload, (part) => {
    if (isAttachment(part) || !part.body?.data) return;
    const type = (part.mimeType ?? "").toLowerCase();
    if (type === "text/plain") plain.push(decodeData(part.body.data, charsetOf(part)));
    else if (type === "text/html") rich.push(htmlToText(decodeData(part.body.data, charsetOf(part))));
  });
  const plainText = tidy(plain.join("\n\n"));
  const richText = rich.join("\n\n").trim();
  // Some senders put only "view this email in your browser" in the text part.
  if (plainText && !(plainText.replace(/\s/gu, "").length < 60 && richText.length > plainText.length * 3)) return plainText;
  return richText;
}

export type AttachmentInfo = { filename: string; mimeType: string; size: number; attachmentId?: string; data?: string };

export function listAttachments(payload: GmailPart | undefined) {
  const found: AttachmentInfo[] = [];
  walk(payload, (part) => {
    if (!part.filename || !(part.body?.attachmentId || part.body?.data)) return;
    found.push({
      filename: part.filename,
      mimeType: part.mimeType ?? "application/octet-stream",
      size: part.body.size ?? 0,
      attachmentId: part.body.attachmentId,
      data: part.body.attachmentId ? undefined : part.body.data,
    });
  });
  return found;
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Cuts long text at a word boundary and says how much was left out. */
export function truncate(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.search(/\s\S*$/u);
  const kept = space > max * 0.8 ? cut.slice(0, space) : cut;
  return `${kept.trimEnd()}\n[… ${text.length - kept.length} more characters not shown]`;
}

/** Drops the quoted history under a reply, so a thread reads each message once. */
export function stripQuoted(text: string) {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const joined = `${line} ${lines[index + 1] ?? ""}`;
    if (
      /^-{2,}\s*(original message|forwarded message)/iu.test(line) ||
      /^On .{4,200}\bwrote:\s*$/iu.test(line) ||
      (/^On .{4,200}$/iu.test(line) && /\bwrote:\s*$/iu.test(joined)) ||
      /^.{0,120}(於|在).{2,80}(寫道|写道)[:：]\s*$/u.test(line) ||
      (/^(From|寄件者|发件人)\s*[:：]/u.test(line) && /^(Sent|Date|寄件日期|日期|发送时间)\s*[:：]/u.test(lines[index + 1] ?? ""))
    ) {
      break;
    }
    if (!line.startsWith(">")) kept.push(line);
  }
  const result = kept.join("\n").trim();
  return result || text.trim();
}

// ---- Raw MIME (IMAP) into the same part tree the Gmail API returns ----

function latin1(bytes: Uint8Array) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return text;
}

function latin1Bytes(text: string) {
  return Uint8Array.from(text, (character) => character.charCodeAt(0) & 0xff);
}

/** A header value's main token and its parameters, with RFC 2231 continuations and charsets. */
export function parseHeaderParams(value: string) {
  const [main, ...rest] = value.match(/(?:[^;"]+|"(?:\\.|[^"\\])*")+/gu) ?? [""];
  const params: Record<string, string> = {};
  const extended: Record<string, Array<{ index: number; value: string; encoded: boolean }>> = {};
  for (const item of rest) {
    const match = /^\s*([^=\s*]+)(\*(\d+))?(\*)?\s*=\s*(.*?)\s*$/su.exec(item);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const raw = match[5].startsWith('"') ? match[5].slice(1, -1).replace(/\\(.)/gu, "$1") : match[5];
    if (match[2] || match[4]) (extended[name] ??= []).push({ index: Number(match[3] ?? 0), value: raw, encoded: Boolean(match[4]) });
    else params[name] = raw;
  }
  for (const [name, pieces] of Object.entries(extended)) {
    pieces.sort((a, b) => a.index - b.index);
    let charset = "utf-8";
    const bytes: number[] = [];
    for (const [position, piece] of pieces.entries()) {
      let text = piece.value;
      if (piece.encoded && position === 0) {
        const parts = /^([^']*)'[^']*'(.*)$/su.exec(text);
        if (parts) {
          charset = parts[1] || charset;
          text = parts[2];
        }
      }
      if (piece.encoded) for (const byte of latin1Bytes(text.replace(/%([0-9A-Fa-f]{2})/gu, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))))) bytes.push(byte);
      else for (const byte of new TextEncoder().encode(text)) bytes.push(byte);
    }
    try {
      params[name] = new TextDecoder(charset).decode(Uint8Array.from(bytes));
    } catch {
      params[name] = new TextDecoder().decode(Uint8Array.from(bytes));
    }
  }
  return { value: (main ?? "").trim().toLowerCase(), params };
}

function decodeQuotedPrintable(text: string) {
  return latin1Bytes(text.replace(/=\r?\n/gu, "").replace(/=([0-9A-Fa-f]{2})/gu, (_match, hex: string) => String.fromCharCode(parseInt(hex, 16))));
}

function base64ToBytes(text: string) {
  let clean = text.replace(/[^A-Za-z0-9+/]/gu, "");
  // A single stray character can't encode a byte; drop it, then restore the padding.
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  try {
    return latin1Bytes(atob(clean.padEnd(Math.ceil(clean.length / 4) * 4, "=")));
  } catch {
    return new Uint8Array();
  }
}

const MAX_MIME_DEPTH = 8;

function parsePart(raw: string, depth: number): GmailPart {
  const split = /\r?\n\r?\n/u.exec(raw);
  const headText = split ? raw.slice(0, split.index) : raw;
  const bodyText = split ? raw.slice(split.index + split[0].length) : "";
  const headers = new TextDecoder()
    .decode(latin1Bytes(headText))
    .replace(/\r?\n[ \t]+/gu, " ")
    .split(/\r?\n/u)
    .map((line) => /^([^:\s]+)\s*:\s*(.*)$/u.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => ({ name: match[1], value: match[2] }));
  const part: GmailPart = { headers };
  const type = parseHeaderParams(header(part, "content-type") || "text/plain");
  const disposition = parseHeaderParams(header(part, "content-disposition"));
  part.mimeType = type.value || "text/plain";
  part.filename = disposition.params.filename ?? type.params.name ?? "";
  if (part.mimeType.startsWith("multipart/") && type.params.boundary && depth < MAX_MIME_DEPTH) {
    const delimiter = `--${type.params.boundary}`;
    const sections = bodyText.split(new RegExp(`(?:^|\\r?\\n)${delimiter.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(--)?[ \\t]*(?:\\r?\\n|$)`, "u"));
    // split() with capture groups interleaves the "--" markers; keep the parts between delimiters.
    const parts: GmailPart[] = [];
    for (let index = 2; index < sections.length; index += 2) {
      if (sections[index - 1] === "--") break;
      parts.push(parsePart(sections[index], depth + 1));
    }
    part.parts = parts;
    return part;
  }
  const encoding = header(part, "content-transfer-encoding").toLowerCase();
  const bytes = encoding === "base64" ? base64ToBytes(bodyText) : encoding === "quoted-printable" ? decodeQuotedPrintable(bodyText) : latin1Bytes(bodyText);
  if (part.mimeType === "message/rfc822" && !part.filename) part.filename = "forwarded message.eml";
  part.body = { data: bytesToBase64Url(bytes), size: bytes.length };
  return part;
}

/** Parses a raw RFC 822 message into Gmail's part tree, so the same readers work for IMAP. */
export function parseMime(raw: Uint8Array) {
  return parsePart(latin1(raw), 0);
}
