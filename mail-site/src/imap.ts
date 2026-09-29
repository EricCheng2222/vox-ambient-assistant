import { decodeHeaderText } from "./mime.ts";
import { Connection } from "./socket.ts";
import { MailError } from "./util.ts";

// A minimal IMAP4rev1 client (RFC 3501) with the extensions mail servers
// commonly offer: SPECIAL-USE folders, MOVE, UIDPLUS, LITERAL+, SASL-IR. It
// handles literals in both directions and modified UTF-7 folder names.

/** The server refused the user name or password. */
export class AuthError extends MailError {}

/** A command the server answered with NO or BAD. */
export class CommandError extends MailError {}

const AUTH_FAILED = "The mail server rejected the user name or app password.";

// ---- Modified UTF-7 (RFC 3501 5.1.3) ----

export function decodeMailboxName(name: string) {
  return name.replace(/&([^-]*)-/gu, (_match, encoded: string) => {
    if (!encoded) return "&";
    const binary = atob(encoded.replace(/,/gu, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "="));
    let text = "";
    for (let index = 0; index + 1 < binary.length; index += 2) text += String.fromCharCode((binary.charCodeAt(index) << 8) | binary.charCodeAt(index + 1));
    return text;
  });
}

export function encodeMailboxName(name: string) {
  let result = "";
  let pending = "";
  const flush = () => {
    if (!pending) return;
    let binary = "";
    for (let index = 0; index < pending.length; index += 1) {
      const code = pending.charCodeAt(index);
      binary += String.fromCharCode(code >> 8, code & 0xff);
    }
    result += `&${btoa(binary).replace(/=+$/u, "").replace(/\//gu, ",")}-`;
    pending = "";
  };
  for (const character of name) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0x20 && code <= 0x7e) {
      flush();
      result += character === "&" ? "&-" : character;
    } else {
      pending += character;
    }
  }
  flush();
  return result;
}

// ---- Responses ----

export type ImapValue = string | Uint8Array | null | ImapValue[];
type Chunk = string | Uint8Array;
export type ImapResponse = { text: string; values: ImapValue[] };

/** Tokenizes a response whose text may be interrupted by literals. */
export function parseValues(chunks: Chunk[]): ImapValue[] {
  let chunk = 0;
  let position = 0;
  const current = () => chunks[chunk];
  const atEnd = () => chunk >= chunks.length;
  const advance = () => {
    const value = current();
    if (typeof value === "string" && position < value.length) return;
    chunk += 1;
    position = 0;
  };
  const skipSpaces = () => {
    for (;;) {
      if (atEnd()) return;
      const value = current();
      if (typeof value !== "string") return;
      while (position < value.length && value[position] === " ") position += 1;
      if (position < value.length) return;
      advance();
    }
  };
  const parseList = (nested: boolean): ImapValue[] => {
    const values: ImapValue[] = [];
    for (;;) {
      skipSpaces();
      if (atEnd()) return values;
      const value = current();
      if (typeof value !== "string") {
        values.push(value);
        chunk += 1;
        position = 0;
        continue;
      }
      const character = value[position];
      if (character === ")") {
        position += 1;
        if (nested) return values;
        continue;
      }
      if (character === "(") {
        position += 1;
        values.push(parseList(true));
        continue;
      }
      if (character === '"') {
        let text = "";
        position += 1;
        while (position < value.length && value[position] !== '"') {
          if (value[position] === "\\" && position + 1 < value.length) position += 1;
          text += value[position];
          position += 1;
        }
        position += 1;
        values.push(text);
        continue;
      }
      let atom = "";
      let depth = 0;
      while (position < value.length) {
        const next = value[position];
        if (next === "[") depth += 1;
        else if (next === "]") depth -= 1;
        else if (depth <= 0 && (next === " " || next === "(" || next === ")")) break;
        atom += next;
        position += 1;
      }
      values.push(atom.toUpperCase() === "NIL" ? null : atom);
    }
  };
  return parseList(false);
}

export function valueText(value: ImapValue | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return "";
}

// ---- Commands ----

export type Literal = { literal: Uint8Array };
type Part = string | Literal;

/** A quoted string, or a literal when quoting can't carry it. */
export function imapString(value: string): Part {
  if (/^[\x20-\x7e]*$/u.test(value)) return `"${value.replace(/(["\\])/gu, "\\$1")}"`;
  return { literal: new TextEncoder().encode(value) };
}

export function mailboxArgument(name: string): Part {
  return imapString(encodeMailboxName(name));
}

export type Mailbox = { name: string; display: string; flags: string[]; delimiter: string };

export type FetchedMessage = {
  uid: number;
  flags: string[];
  internalDate: string;
  size: number;
  envelope: ImapValue[] | null;
  body: Uint8Array | null;
  headerFields: string;
};

export type ImapLogin = { host: string; port: number; security: "tls" | "starttls"; username: string; password: string };

export class ImapClient {
  private connection: Connection;
  private tag = 0;
  capabilities = new Set<string>();
  selected: { name: string; uidValidity: number; readOnly: boolean } | null = null;

  private constructor(connection: Connection) {
    this.connection = connection;
  }

  /** Connects, upgrades to TLS if needed, and signs in. */
  static async connect(login: ImapLogin) {
    const connection = await Connection.open(login.host, login.port, login.security === "tls" ? "on" : "starttls");
    const client = new ImapClient(connection);
    try {
      const greeting = await connection.readLine();
      if (/^\* BYE/iu.test(greeting)) throw new MailError(`${login.host} refused the connection.`);
      if (login.security === "starttls") {
        await client.command(["STARTTLS"]);
        connection.upgrade();
      } else {
        client.readCapabilities(greeting);
      }
      if (!client.capabilities.size || login.security === "starttls") await client.refreshCapabilities();
      await client.login(login.username, login.password);
      return client;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  private readCapabilities(text: string) {
    const match = /\[CAPABILITY ([^\]]+)\]/iu.exec(text) ?? /^\* CAPABILITY (.+)$/imu.exec(text);
    if (match) this.capabilities = new Set(match[1].toUpperCase().split(/\s+/u));
  }

  async refreshCapabilities() {
    const result = await this.command(["CAPABILITY"]);
    for (const response of result.untagged) if (/^\* CAPABILITY /iu.test(response.text)) this.readCapabilities(response.text);
  }

  has(capability: string) {
    return this.capabilities.has(capability.toUpperCase());
  }

  private async login(username: string, password: string) {
    try {
      if (this.has("AUTH=PLAIN")) {
        const token = btoa(String.fromCharCode(...new TextEncoder().encode(`\0${username}\0${password}`)));
        if (this.has("SASL-IR")) await this.command([`AUTHENTICATE PLAIN ${token}`]);
        else await this.command(["AUTHENTICATE PLAIN"], async () => token);
      } else {
        await this.command(["LOGIN", imapString(username), imapString(password)]);
      }
    } catch (error) {
      // A refusal is a bad password; a dropped connection is not.
      if (error instanceof CommandError) throw new AuthError(AUTH_FAILED);
      throw error;
    }
    // Some servers list more capabilities once signed in.
    await this.refreshCapabilities();
  }

  /** Reads one response, with any literals it carries. */
  private async readResponse(): Promise<{ chunks: Chunk[]; text: string }> {
    const chunks: Chunk[] = [];
    let text = "";
    for (;;) {
      const line = await this.connection.readLine();
      const literal = /\{(\d+)\}$/u.exec(line);
      if (!literal) {
        chunks.push(line);
        text += line;
        return { chunks, text };
      }
      const size = Number(literal[1]);
      if (size > 40 * 1024 * 1024) throw new MailError("The mail server sent a message that is too large.");
      chunks.push(line.slice(0, literal.index));
      text += line.slice(0, literal.index) + "{…}";
      chunks.push(await this.connection.readBytes(size));
    }
  }

  /**
   * Sends a command (literals included) and collects untagged responses until
   * it completes. `onContinue` answers "+" continuation requests (SASL).
   */
  async command(parts: Part[], onContinue?: (text: string) => Promise<string>) {
    const tag = `V${(this.tag += 1).toString().padStart(3, "0")}`;
    const untagged: ImapResponse[] = [];
    const literalPlus = this.has("LITERAL+");
    let line = `${tag}`;
    for (const part of parts) {
      if (typeof part === "string") {
        line += ` ${part}`;
        continue;
      }
      await this.connection.write(`${line} {${part.literal.length}${literalPlus ? "+" : ""}}\r\n`);
      if (!literalPlus) {
        for (;;) {
          const response = await this.readResponse();
          if (response.text.startsWith("+")) break;
          if (response.text.startsWith(`${tag} `)) throw new CommandError(`${this.connection.host}: ${response.text.slice(tag.length + 1, 200)}`);
          untagged.push({ text: response.text, values: parseValues(response.chunks) });
        }
      }
      await this.connection.write(part.literal);
      line = "";
    }
    await this.connection.write(`${line}\r\n`);
    for (;;) {
      const response = await this.readResponse();
      if (response.text.startsWith("+")) {
        if (!onContinue) throw new MailError(`${this.connection.host} asked for more than expected.`);
        await this.connection.write(`${await onContinue(response.text)}\r\n`);
        continue;
      }
      if (response.text.startsWith(`${tag} `)) {
        const status = response.text.slice(tag.length + 1);
        if (!/^OK\b/iu.test(status)) {
          if (/AUTHENTICATIONFAILED|AUTHORIZATIONFAILED/iu.test(status)) throw new AuthError(AUTH_FAILED);
          throw new CommandError(`${this.connection.host}: ${status.slice(0, 200)}`);
        }
        return { status, untagged };
      }
      untagged.push({ text: response.text, values: parseValues(response.chunks) });
    }
  }

  async list(): Promise<Mailbox[]> {
    const result = await this.command(this.has("SPECIAL-USE") ? ['LIST "" "*" RETURN (SPECIAL-USE)'] : ['LIST "" "*"']);
    const mailboxes: Mailbox[] = [];
    for (const response of result.untagged) {
      const [star, kind, flags, delimiter, name] = response.values;
      if (star !== "*" || typeof kind !== "string" || kind.toUpperCase() !== "LIST") continue;
      const raw = valueText(name);
      mailboxes.push({
        name: raw,
        display: decodeMailboxName(raw),
        flags: Array.isArray(flags) ? flags.map((flag) => valueText(flag).toLowerCase()) : [],
        delimiter: valueText(delimiter),
      });
    }
    return mailboxes;
  }

  /** Selects a mailbox (EXAMINE for reading only) and returns its UIDVALIDITY. */
  async select(name: string, readOnly = true) {
    if (this.selected?.name === name && (readOnly || !this.selected.readOnly)) return this.selected.uidValidity;
    const result = await this.command([readOnly ? "EXAMINE" : "SELECT", imapString(name)]);
    let uidValidity = 0;
    for (const response of result.untagged) {
      const match = /\[UIDVALIDITY (\d+)\]/iu.exec(response.text);
      if (match) uidValidity = Number(match[1]);
    }
    this.selected = { name, uidValidity, readOnly };
    return uidValidity;
  }

  async status(name: string, items: string[]) {
    const result = await this.command(["STATUS", imapString(name), `(${items.join(" ")})`]);
    const counts: Record<string, number> = {};
    for (const response of result.untagged) {
      const values = response.values.at(-1);
      if (!Array.isArray(values)) continue;
      for (let index = 0; index + 1 < values.length; index += 2) counts[valueText(values[index]).toUpperCase()] = Number(valueText(values[index + 1]));
    }
    return counts;
  }

  /** UID SEARCH; criteria may include literals (sent with CHARSET UTF-8). */
  async search(criteria: Part[]) {
    const utf8 = criteria.some((part) => typeof part !== "string");
    const result = await this.command(["UID SEARCH", ...(utf8 ? ["CHARSET UTF-8"] : []), ...(criteria.length ? criteria : ["ALL"])]);
    const uids: number[] = [];
    for (const response of result.untagged) {
      if (!/^\* SEARCH\b/iu.test(response.text)) continue;
      for (const value of response.values.slice(2)) if (typeof value === "string" && /^\d+$/u.test(value)) uids.push(Number(value));
    }
    return uids;
  }

  async fetch(uids: number[], items: string): Promise<FetchedMessage[]> {
    if (!uids.length) return [];
    const result = await this.command([`UID FETCH ${uids.join(",")} (${items})`]);
    const messages: FetchedMessage[] = [];
    for (const response of result.untagged) {
      const [star, , kind, data] = response.values;
      if (star !== "*" || typeof kind !== "string" || kind.toUpperCase() !== "FETCH" || !Array.isArray(data)) continue;
      const message: FetchedMessage = { uid: 0, flags: [], internalDate: "", size: 0, envelope: null, body: null, headerFields: "" };
      for (let index = 0; index + 1 < data.length; index += 2) {
        const key = valueText(data[index]).toUpperCase();
        const value = data[index + 1];
        if (key === "UID") message.uid = Number(valueText(value));
        else if (key === "FLAGS" && Array.isArray(value)) message.flags = value.map((flag) => valueText(flag));
        else if (key === "INTERNALDATE") message.internalDate = valueText(value);
        else if (key === "RFC822.SIZE") message.size = Number(valueText(value));
        else if (key === "ENVELOPE" && Array.isArray(value)) message.envelope = value;
        else if (key.startsWith("BODY[HEADER")) message.headerFields = valueText(value);
        else if (key.startsWith("BODY[]")) message.body = value instanceof Uint8Array ? value : new TextEncoder().encode(valueText(value));
      }
      if (message.uid) messages.push(message);
    }
    return messages;
  }

  async store(uids: number[], change: "+FLAGS.SILENT" | "-FLAGS.SILENT", flags: string[]) {
    if (uids.length) await this.command([`UID STORE ${uids.join(",")} ${change} (${flags.join(" ")})`]);
  }

  /** Moves messages; returns their new UIDs when the server reports them (COPYUID). */
  async move(uids: number[], target: string) {
    const moved = { uidValidity: undefined as number | undefined, uids: new Map<number, number>() };
    if (!uids.length) return moved;
    let result;
    if (this.has("MOVE")) {
      result = await this.command([`UID MOVE ${uids.join(",")}`, imapString(target)]);
    } else {
      // No MOVE: copy, flag the originals deleted, and expunge just those.
      result = await this.command([`UID COPY ${uids.join(",")}`, imapString(target)]);
      await this.store(uids, "+FLAGS.SILENT", ["\\Deleted"]);
      await this.command([this.has("UIDPLUS") ? `UID EXPUNGE ${uids.join(",")}` : "EXPUNGE"]);
    }
    const texts = [result.status, ...result.untagged.map((response) => response.text)];
    const copied = texts.map((text) => /\[COPYUID (\d+) ([\d:,]+) ([\d:,]+)\]/iu.exec(text)).find(Boolean);
    if (copied) {
      moved.uidValidity = Number(copied[1]);
      const from = expandUidSet(copied[2]);
      const to = expandUidSet(copied[3]);
      from.forEach((uid, index) => to[index] !== undefined && moved.uids.set(uid, to[index]));
    }
    return moved;
  }

  async deleteMessages(uids: number[]) {
    if (!uids.length) return;
    await this.store(uids, "+FLAGS.SILENT", ["\\Deleted"]);
    await this.command([this.has("UIDPLUS") ? `UID EXPUNGE ${uids.join(",")}` : "EXPUNGE"]);
  }

  /** APPEND; returns the new UID when the server reports it (APPENDUID). */
  async append(mailbox: string, flags: string[], message: Uint8Array) {
    const result = await this.command(["APPEND", imapString(mailbox), `(${flags.join(" ")})`, { literal: message }]);
    const match = /\[APPENDUID (\d+) (\d+)\]/iu.exec(result.status);
    return match ? { uidValidity: Number(match[1]), uid: Number(match[2]) } : null;
  }

  async logout() {
    try {
      await this.command(["LOGOUT"]);
    } catch {
      // Closing anyway.
    }
    await this.connection.close();
  }
}

function expandUidSet(set: string) {
  const uids: number[] = [];
  for (const range of set.split(",")) {
    const [start, end] = range.split(":").map(Number);
    if (end === undefined) uids.push(start);
    else for (let uid = Math.min(start, end); uid <= Math.max(start, end) && uids.length < 10_000; uid += 1) uids.push(uid);
  }
  return uids;
}

// ---- ENVELOPE (RFC 3501 7.4.2) ----

function envelopeAddresses(value: ImapValue | undefined) {
  if (!Array.isArray(value)) return "";
  return value
    .filter((item): item is ImapValue[] => Array.isArray(item) && item[3] != null)
    .map((item) => {
      const address = `${valueText(item[2])}@${valueText(item[3])}`;
      const name = decodeHeaderText(valueText(item[0]));
      return name ? `${name} <${address}>` : address;
    })
    .join(", ");
}

export function readEnvelope(envelope: ImapValue[] | null) {
  const value = envelope ?? [];
  return {
    date: valueText(value[0]),
    subject: decodeHeaderText(valueText(value[1])),
    from: envelopeAddresses(value[2]),
    replyTo: envelopeAddresses(value[4]),
    to: envelopeAddresses(value[5]),
    cc: envelopeAddresses(value[6]),
    inReplyTo: valueText(value[8]),
    messageId: valueText(value[9]),
  };
}
