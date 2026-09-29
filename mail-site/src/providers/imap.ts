import { type ImapConfig, type MailAccount, markDisconnected, openSecret } from "../accounts.ts";
import { reconnectError } from "../connect.ts";
import { AuthError, type FetchedMessage, ImapClient, imapString, type Literal, readEnvelope } from "../imap.ts";
import { header, listAttachments, messageText, parseMime } from "../message.ts";
import { type Address, type Attachment, buildMessage, newMessageId, type OutgoingMessage, parseAddressList } from "../mime.ts";
import { imapDate, parseQuery } from "../query.ts";
import { sendSmtp, verifySmtp } from "../smtp.ts";
import { base64UrlToBytes, type Env, MailError } from "../util.ts";
import { FORWARD_ATTACHMENT_LIMIT, forwardBody, replyDraft, replyMessage } from "./compose.ts";
import type { ChangeResult, Compose, FullMessage, MailProvider, MessageSummary } from "./types.ts";

// Any other mailbox through IMAP (reading, folders, flags) and SMTP
// (sending), with an app password. A message id here is
// "<UIDVALIDITY>:<UID>:<mailbox>"; a thread id is the conversation's first
// Message-ID.

type Preset = {
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: "tls" | "starttls";
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: "tls" | "starttls";
  saveSent: boolean;
  domains: string[];
  help: string;
};

export const IMAP_PRESETS: Record<string, Preset> = {
  icloud: {
    name: "iCloud Mail",
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecurity: "starttls",
    // iCloud files sent mail itself.
    saveSent: false,
    domains: ["icloud.com", "me.com", "mac.com"],
    help: "Create an app-specific password at account.apple.com → Sign-In and Security → App-Specific Passwords. Your Apple Account needs two-factor authentication.",
  },
  yahoo: {
    name: "Yahoo Mail",
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    saveSent: true,
    domains: ["yahoo.com", "ymail.com", "rocketmail.com"],
    help: "Create an app password at login.yahoo.com → Account Info → Account Security → Generate app password.",
  },
  fastmail: {
    name: "Fastmail",
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.fastmail.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    saveSent: true,
    domains: ["fastmail.com", "fastmail.fm"],
    help: "Create an app password in Fastmail → Settings → Privacy & Security → Manage app passwords, with IMAP and SMTP access.",
  },
  gmail: {
    name: "Gmail (app password)",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    // Gmail files sent mail itself.
    saveSent: false,
    domains: [],
    help: "Turn on 2-Step Verification, then create an app password at myaccount.google.com/apppasswords. Signing in with Google instead needs no password.",
  },
  zoho: {
    name: "Zoho Mail",
    imapHost: "imap.zoho.com",
    imapPort: 993,
    imapSecurity: "tls",
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
    smtpSecurity: "tls",
    saveSent: true,
    domains: ["zoho.com", "zohomail.com"],
    help: "Turn on IMAP access in Zoho Mail settings, then create an app-specific password at accounts.zoho.com → Security → App Passwords.",
  },
};

/** Microsoft turned off password sign-in for these; they connect through Microsoft instead. */
export function isOutlookAddress(email: string) {
  return /@(outlook|hotmail|live|msn|passport)\.[a-z.]+$/iu.test(email.trim());
}

export function presetForEmail(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
  return Object.entries(IMAP_PRESETS).find(([, preset]) => preset.domains.includes(domain))?.[0] ?? "custom";
}

const MESSAGE_ID = /^(\d{1,10}):(\d{1,10}):([\s\S]{1,300})$/u;
const THREAD_ID = /^<[^<>\s]{1,300}>$/u;
const SUMMARY_ITEMS = "UID FLAGS INTERNALDATE ENVELOPE BODY.PEEK[HEADER.FIELDS (REFERENCES)]";
const READ_CAP = 5 * 1024 * 1024;
const THREAD_CAP = 1024 * 1024;
const SEND_CAP = 25 * 1024 * 1024;

type Special = "sent" | "trash" | "drafts" | "archive" | "junk" | "all";
const SPECIAL_NAMES: Record<Special, string[]> = {
  sent: ["sent", "sent messages", "sent items", "sent mail", "[gmail]/sent mail", "inbox.sent"],
  trash: ["trash", "deleted messages", "deleted items", "deleted", "[gmail]/trash", "[gmail]/bin", "inbox.trash"],
  drafts: ["drafts", "draft", "[gmail]/drafts", "inbox.drafts"],
  archive: ["archive", "archives", "inbox.archive"],
  junk: ["junk", "spam", "bulk mail", "junk e-mail", "junk email", "[gmail]/spam", "inbox.junk"],
  all: [],
};

function parseId(id: string) {
  const match = MESSAGE_ID.exec(id);
  if (!match) throw new MailError("Give a valid message id.");
  return { uidValidity: Number(match[1]), uid: Number(match[2]), mailbox: match[3] };
}

/** INTERNALDATE ("29-Sep-2026 10:00:00 +0800") in milliseconds. */
function internalTime(value: string) {
  return Date.parse(value.replace(/^(\d{1,2})-(\w{3})-(\d{4})/u, "$1 $2 $3")) || 0;
}

function threadRoot(references: string, inReplyTo: string, messageId: string) {
  return references.match(/<[^<>\s]+>/u)?.[0] ?? inReplyTo.match(/<[^<>\s]+>/u)?.[0] ?? messageId.match(/<[^<>\s]+>/u)?.[0] ?? "";
}

function latin1(bytes: Uint8Array) {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return text;
}

/** Checks the settings by signing in to both servers, before an account is saved. */
export async function verifyImapAccount(config: ImapConfig, password: string) {
  const imap = await ImapClient.connect({ host: config.imapHost, port: config.imapPort, security: config.imapSecurity, username: config.username, password });
  await imap.logout();
  await verifySmtp({ host: config.smtpHost, port: config.smtpPort, security: config.smtpSecurity, username: config.username, password });
}

export class ImapProvider implements MailProvider {
  readonly email: string;
  private readonly env: Env;
  private readonly account: MailAccount;
  private readonly config: ImapConfig;
  private readonly siteUrl: string;
  private client: Promise<ImapClient> | undefined;
  private mailboxes: Promise<Array<{ name: string; display: string; flags: string[] }>> | undefined;

  constructor(env: Env, account: MailAccount, siteUrl: string) {
    this.env = env;
    this.account = account;
    this.email = account.email;
    this.siteUrl = siteUrl;
    this.config = JSON.parse(account.config) as ImapConfig;
  }

  private password() {
    return openSecret(this.env, this.account, this.account.secret, this.account.iv);
  }

  /** A rejected password marks the account for reconnecting; a network problem doesn't. */
  private async guard<T>(work: Promise<T>) {
    try {
      return await work;
    } catch (error) {
      if (error instanceof AuthError) {
        await markDisconnected(this.env.DB, this.account);
        throw reconnectError(this.account, this.siteUrl, `The mail server no longer accepts the app password for ${this.email}.`);
      }
      throw error;
    }
  }

  private imap() {
    if (this.account.status !== "connected") {
      return Promise.reject(reconnectError(this.account, this.siteUrl, `The app password for ${this.email} stopped working.`));
    }
    this.client ??= this.guard(
      this.password().then((password) =>
        ImapClient.connect({ host: this.config.imapHost, port: this.config.imapPort, security: this.config.imapSecurity, username: this.config.username, password }),
      ),
    );
    return this.client;
  }

  async close() {
    if (!this.client) return;
    const client = await this.client.catch(() => null);
    this.client = undefined;
    await client?.logout();
  }

  private async list() {
    this.mailboxes ??= this.imap().then((imap) => imap.list());
    return (await this.mailboxes).filter((mailbox) => !mailbox.flags.includes("\\noselect"));
  }

  private async special(kind: Special) {
    const mailboxes = await this.list();
    return (
      mailboxes.find((mailbox) => mailbox.flags.includes(`\\${kind}`))?.name ??
      mailboxes.find((mailbox) => SPECIAL_NAMES[kind].includes(mailbox.display.toLowerCase()))?.name
    );
  }

  private async requireSpecial(kind: Special) {
    const name = await this.special(kind);
    if (!name) throw new MailError(`${this.email} has no ${kind === "junk" ? "Junk" : kind[0].toUpperCase() + kind.slice(1)} folder.`);
    return name;
  }

  /** A folder name the user said ("sent", "Receipts") as the server's name. */
  private async resolveFolder(name: string) {
    const key = name.trim().toLowerCase();
    if (key === "inbox") return "INBOX";
    const special = ({ sent: "sent", trash: "trash", bin: "trash", drafts: "drafts", draft: "drafts", archive: "archive", spam: "junk", junk: "junk", all: "all", anywhere: "all" } as const)[
      key as "sent"
    ];
    if (special) return this.requireSpecial(special);
    const found = (await this.list()).find((mailbox) => mailbox.display.toLowerCase() === key || mailbox.name.toLowerCase() === key);
    if (!found) throw new MailError(`${this.email} has no folder called "${name.slice(0, 60)}".`);
    return found.name;
  }

  private async display(mailbox: string) {
    return (await this.list()).find((item) => item.name === mailbox)?.display ?? mailbox;
  }

  /** Selects the message's mailbox and makes sure the id still refers to the same message. */
  private async open(id: string, readOnly: boolean) {
    const ref = parseId(id);
    const imap = await this.imap();
    const uidValidity = await imap.select(ref.mailbox, readOnly);
    if (uidValidity !== ref.uidValidity) throw new MailError("That email id is out of date. Search again.");
    return { imap, ...ref };
  }

  private async summary(message: FetchedMessage, mailbox: string, uidValidity: number): Promise<MessageSummary> {
    const envelope = readEnvelope(message.envelope);
    const references = /^references:\s*([\s\S]*)$/imu.exec(message.headerFields.replace(/\r?\n[ \t]+/gu, " "))?.[1] ?? "";
    const labels = [await this.display(mailbox)];
    if (message.flags.some((flag) => flag.toLowerCase() === "\\flagged")) labels.push("STARRED");
    return {
      id: `${uidValidity}:${message.uid}:${mailbox}`,
      threadId: threadRoot(references, envelope.inReplyTo, envelope.messageId),
      from: envelope.from,
      to: envelope.to,
      cc: envelope.cc,
      subject: envelope.subject,
      date: envelope.date,
      time: internalTime(message.internalDate) || Date.parse(envelope.date) || 0,
      snippet: "",
      labels,
      unread: !message.flags.some((flag) => flag.toLowerCase() === "\\seen"),
    };
  }

  private async full(message: FetchedMessage, mailbox: string, uidValidity: number): Promise<FullMessage> {
    const envelope = readEnvelope(message.envelope);
    const part = parseMime(message.body ?? new Uint8Array());
    const references = header(part, "references");
    return {
      ...(await this.summary(message, mailbox, uidValidity)),
      threadId: threadRoot(references, envelope.inReplyTo, envelope.messageId),
      body: messageText(part),
      attachments: listAttachments(part).map(({ filename, mimeType, size }) => ({ filename, mimeType, size })),
      replyTo: envelope.replyTo,
      messageId: envelope.messageId,
      references,
    };
  }

  private async fetchFull(id: string, cap: number) {
    const { imap, uid, mailbox, uidValidity } = await this.open(id, true);
    const [message] = await imap.fetch([uid], `UID FLAGS INTERNALDATE ENVELOPE BODY.PEEK[]<0.${cap}>`);
    if (!message) throw new MailError("There's no email with that id. It may have moved; search again.");
    return { message, mailbox, uidValidity };
  }

  async search(query: string, max: number, pageToken?: string) {
    const parsed = parseQuery(query);
    const mailbox = parsed.folder ? await this.resolveFolder(parsed.folder) : ((await this.special("all")) ?? "INBOX");
    const imap = await this.imap();
    const uidValidity = await imap.select(mailbox, true);
    const criteria: Array<string | Literal> = [];
    const add = (key: string, value: string) => criteria.push(key, imapString(value));
    for (const value of parsed.from) add("FROM", value);
    for (const value of parsed.to) add("TO", value);
    for (const value of parsed.subject) add("SUBJECT", value);
    for (const value of parsed.text) add("TEXT", value);
    if (parsed.unread !== undefined) criteria.push(parsed.unread ? "UNSEEN" : "SEEN");
    if (parsed.starred !== undefined) criteria.push(parsed.starred ? "FLAGGED" : "UNFLAGGED");
    if (parsed.after) criteria.push("SINCE", imapDate(parsed.after));
    if (parsed.before) criteria.push("BEFORE", imapDate(parsed.before));
    if (parsed.hasAttachment) add("HEADER Content-Type", "multipart/mixed");
    let uids = (await imap.search(criteria)).sort((a, b) => b - a);
    const page = /^(\d+):(\d+)$/u.exec(pageToken ?? "");
    if (page && Number(page[1]) === uidValidity) uids = uids.filter((uid) => uid < Number(page[2]));
    const shown = uids.slice(0, max);
    const fetched = (await imap.fetch(shown, SUMMARY_ITEMS)).sort((a, b) => b.uid - a.uid);
    return {
      messages: await Promise.all(fetched.map((message) => this.summary(message, mailbox, uidValidity))),
      next: uids.length > max ? `${uidValidity}:${shown.at(-1)}` : undefined,
    };
  }

  async read(id: string) {
    const { message, mailbox, uidValidity } = await this.fetchFull(id, READ_CAP);
    return this.full(message, mailbox, uidValidity);
  }

  async thread(id: string) {
    if (!THREAD_ID.test(id)) throw new MailError("Give a valid thread id.");
    const imap = await this.imap();
    const all = await this.special("all");
    const mailboxes = all ? [all] : ["INBOX", ...[await this.special("sent"), await this.special("archive")].filter((name): name is string => Boolean(name))];
    const found = new Map<string, FullMessage>();
    for (const mailbox of mailboxes) {
      const uidValidity = await imap.select(mailbox, true);
      const uids = await imap.search(["OR HEADER Message-ID", imapString(id), "HEADER References", imapString(id)]);
      for (const message of await imap.fetch(uids.slice(-25), `UID FLAGS INTERNALDATE ENVELOPE BODY.PEEK[]<0.${THREAD_CAP}>`)) {
        const full = await this.full(message, mailbox, uidValidity);
        found.set(full.messageId || full.id, full);
      }
    }
    if (!found.size) throw new MailError("There's no conversation with that id.");
    return [...found.values()].sort((a, b) => a.time - b.time);
  }

  async folders() {
    const mailboxes = await this.list();
    const specials = new Set<string>(["INBOX"]);
    for (const kind of Object.keys(SPECIAL_NAMES) as Special[]) {
      const name = await this.special(kind);
      if (name) specials.add(name);
    }
    return {
      kind: "folders",
      system: mailboxes.filter((mailbox) => specials.has(mailbox.name)).map((mailbox) => mailbox.display),
      own: mailboxes.filter((mailbox) => !specials.has(mailbox.name)).map((mailbox) => mailbox.display).sort(),
    };
  }

  async unread(max: number) {
    const imap = await this.imap();
    const status = await imap.status("INBOX", ["UNSEEN"]);
    const uidValidity = await imap.select("INBOX", true);
    const uids = (await imap.search(["UNSEEN"])).sort((a, b) => b - a).slice(0, max);
    const fetched = (await imap.fetch(uids, SUMMARY_ITEMS)).sort((a, b) => b.uid - a.uid);
    return { count: status.UNSEEN ?? uids.length, latest: await Promise.all(fetched.map((message) => this.summary(message, "INBOX", uidValidity))) };
  }

  private outgoing(message: OutgoingMessage): OutgoingMessage {
    return { ...message, from: { name: "", email: this.email }, date: new Date(), messageId: newMessageId(this.email) };
  }

  /** Sends through SMTP, then files a copy in Sent unless the server does that itself. */
  private async deliver(message: OutgoingMessage) {
    const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map((address) => address.email);
    const password = await this.password();
    await this.guard(
      sendSmtp(
        { host: this.config.smtpHost, port: this.config.smtpPort, security: this.config.smtpSecurity, username: this.config.username, password },
        this.email,
        recipients,
        new TextEncoder().encode(buildMessage(message, { omitBcc: true })),
      ),
    );
    if (this.config.saveSent) await this.fileCopy("sent", new TextEncoder().encode(buildMessage(message)), ["\\Seen"]);
  }

  /** Best effort: the message is already sent, so a missing Sent copy isn't an error. */
  private async fileCopy(kind: Special, message: Uint8Array, flags: string[]) {
    try {
      const mailbox = await this.special(kind);
      if (mailbox) await (await this.imap()).append(mailbox, flags, message);
    } catch (error) {
      console.error("Filing a sent copy failed", error instanceof MailError ? error.message : "unknown");
    }
  }

  async send(input: Compose) {
    const message = this.outgoing(input);
    await this.deliver(message);
    return { id: message.messageId };
  }

  async reply(id: string, body: string, replyAll: boolean) {
    const message = this.outgoing(replyMessage(await this.read(id), this.email, body, replyAll));
    if (!message.to.length) throw new MailError("That email has no address to reply to.");
    await this.deliver(message);
    return { to: message.to, cc: message.cc ?? [], subject: message.subject };
  }

  async forward(id: string, to: Address[], note: string) {
    const { message, mailbox, uidValidity } = await this.fetchFull(id, FORWARD_ATTACHMENT_LIMIT + 2 * 1024 * 1024);
    const original = await this.full(message, mailbox, uidValidity);
    const found = listAttachments(parseMime(message.body ?? new Uint8Array()));
    const total = found.reduce((sum, item) => sum + item.size, 0);
    const attachments: Attachment[] =
      total <= FORWARD_ATTACHMENT_LIMIT ? found.map((item) => ({ filename: item.filename, mimeType: item.mimeType, data: base64UrlToBytes(item.data ?? "") })) : [];
    const { subject, body } = forwardBody(original, note);
    await this.deliver(this.outgoing({ to, subject, body, attachments }));
    return { subject, attachments: attachments.length, skippedBytes: found.length && !attachments.length ? total : 0 };
  }

  async createDraft(input: Compose, replyToId?: string) {
    const message = this.outgoing(replyToId ? replyDraft(await this.read(replyToId), this.email, input) : input);
    const drafts = await this.requireSpecial("drafts");
    const imap = await this.imap();
    const appended = await imap.append(drafts, ["\\Draft", "\\Seen"], new TextEncoder().encode(buildMessage(message)));
    let ref = appended ? `${appended.uidValidity}:${appended.uid}:${drafts}` : "";
    if (!ref) {
      const uidValidity = await imap.select(drafts, true);
      const [uid] = (await imap.search(["HEADER Message-ID", imapString(message.messageId ?? "")])).slice(-1);
      if (!uid) throw new MailError("The draft was saved, but the server didn't say where. Find it with search_email in:drafts.");
      ref = `${uidValidity}:${uid}:${drafts}`;
    }
    return { id: ref, to: message.to, cc: message.cc ?? [], bcc: message.bcc ?? [], subject: message.subject };
  }

  async sendDraft(id: string) {
    const drafts = await this.requireSpecial("drafts");
    if (parseId(id).mailbox !== drafts) throw new MailError("That email isn't in Drafts.");
    const { message } = await this.fetchFull(id, SEND_CAP);
    const raw = message.body ?? new Uint8Array();
    const part = parseMime(raw);
    const recipients = ["to", "cc", "bcc"].flatMap((name) => parseAddressList(header(part, name)).map((address) => address.email));
    if (!recipients.length) throw new MailError("That draft has no recipients yet.");
    // Recipients never see Bcc: drop it from the header section before sending.
    const text = latin1(raw);
    const split = /\r?\n\r?\n/u.exec(text);
    const head = (split ? text.slice(0, split.index) : text).replace(/^Bcc:.*(?:\r?\n[ \t].*)*\r?\n?/gimu, "");
    const withoutBcc = Uint8Array.from(split ? `${head}${text.slice(split.index)}` : head, (character) => character.charCodeAt(0) & 0xff);
    const password = await this.password();
    await this.guard(
      sendSmtp({ host: this.config.smtpHost, port: this.config.smtpPort, security: this.config.smtpSecurity, username: this.config.username, password }, this.email, recipients, withoutBcc),
    );
    if (this.config.saveSent) await this.fileCopy("sent", raw, ["\\Seen"]);
    const { imap, uid } = await this.open(id, false);
    await imap.deleteMessages([uid]);
    return { to: header(part, "to"), subject: header(part, "subject") };
  }

  /** Groups ids by mailbox, checking each id is still current. */
  private async byMailbox(ids: string[]) {
    const groups = new Map<string, { uidValidity: number; uids: number[]; ids: string[] }>();
    for (const id of ids) {
      const ref = parseId(id);
      const group = groups.get(ref.mailbox) ?? { uidValidity: ref.uidValidity, uids: [], ids: [] };
      if (group.uidValidity !== ref.uidValidity) throw new MailError("An email id is out of date. Search again.");
      group.uids.push(ref.uid);
      group.ids.push(id);
      groups.set(ref.mailbox, group);
    }
    return groups;
  }

  private async selectGroup(mailbox: string, uidValidity: number) {
    const imap = await this.imap();
    if ((await imap.select(mailbox, false)) !== uidValidity) throw new MailError("An email id is out of date. Search again.");
    return imap;
  }

  /**
   * Gmail-style label changes in IMAP terms: UNREAD is \Seen, STARRED is
   * \Flagged, and INBOX, SPAM, ARCHIVE, and folder names are moves.
   */
  async modify(ids: string[], add: string[], remove: string[]) {
    const flagsOn: string[] = [];
    const flagsOff: string[] = [];
    let destination: string | undefined;
    const move = (target: string) => {
      if (destination && destination !== target) throw new MailError("Move emails to one folder at a time.");
      destination = target;
    };
    const apply = async (name: string, adding: boolean) => {
      const key = name.trim().toLowerCase();
      if (key === "unread") (adding ? flagsOff : flagsOn).push("\\Seen");
      else if (key === "read") (adding ? flagsOn : flagsOff).push("\\Seen");
      else if (key === "starred" || key === "star" || key === "flagged") (adding ? flagsOn : flagsOff).push("\\Flagged");
      else if (key === "important") throw new MailError(`${this.email} has no Important marker; star it instead.`);
      else if (key === "trash") throw new MailError("Use trash_email or untrash_email for Trash.");
      else if (key === "inbox") move(adding ? "INBOX" : await this.requireSpecial("archive"));
      else if (key === "spam" || key === "junk") move(adding ? await this.requireSpecial("junk") : "INBOX");
      else if (key === "archive") move(adding ? await this.requireSpecial("archive") : "INBOX");
      else move(adding ? await this.resolveFolder(name) : "INBOX");
    };
    for (const name of add) await apply(name, true);
    for (const name of remove) await apply(name, false);
    for (const [mailbox, group] of await this.byMailbox(ids)) {
      const imap = await this.selectGroup(mailbox, group.uidValidity);
      if (flagsOn.length) await imap.store(group.uids, "+FLAGS.SILENT", flagsOn);
      if (flagsOff.length) await imap.store(group.uids, "-FLAGS.SILENT", flagsOff);
      if (destination && destination !== mailbox) await imap.move(group.uids, destination);
    }
    return { added: add, removed: remove };
  }

  /** Moves messages and reports their ids in the new folder. */
  private async moveAll(ids: string[], target: string, from?: string): Promise<ChangeResult[]> {
    const results: ChangeResult[] = [];
    for (const [mailbox, group] of await this.byMailbox(ids)) {
      if (from && mailbox !== from) {
        for (const id of group.ids) results.push({ id, ok: false, error: "It isn't in Trash." });
        continue;
      }
      try {
        const imap = await this.selectGroup(mailbox, group.uidValidity);
        const present = await imap.fetch(group.uids, "UID ENVELOPE");
        const messageIds = new Map(present.map((message) => [message.uid, readEnvelope(message.envelope).messageId]));
        const moved = await imap.move(
          present.map((message) => message.uid),
          target,
        );
        const targetValidity = await imap.select(target, true);
        for (const [index, uid] of group.uids.entries()) {
          if (!messageIds.has(uid)) {
            results.push({ id: group.ids[index], ok: false, error: "There's no email with that id." });
            continue;
          }
          let newUid = moved.uids.get(uid);
          const messageId = messageIds.get(uid);
          if (!newUid && messageId) newUid = (await imap.search(["HEADER Message-ID", imapString(messageId)])).at(-1);
          results.push({ id: group.ids[index], ok: true, newId: newUid ? `${moved.uidValidity ?? targetValidity}:${newUid}:${target}` : undefined });
        }
      } catch (error) {
        if (error instanceof MailError && /no longer accepts/u.test(error.message)) throw error;
        for (const id of group.ids) results.push({ id, ok: false, error: error instanceof MailError ? error.message : "failed" });
      }
    }
    return results;
  }

  async trash(ids: string[]) {
    return this.moveAll(ids, await this.requireSpecial("trash"));
  }

  async untrash(ids: string[]) {
    const trash = await this.requireSpecial("trash");
    return this.moveAll(ids, "INBOX", trash);
  }
}
