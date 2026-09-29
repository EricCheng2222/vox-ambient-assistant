import type { MailAccount } from "../accounts.ts";
import { GMAIL_API, OAuthAccess, reconnectError } from "../connect.ts";
import { decodeEntities, type GmailMessage, header, listAttachments, messageText } from "../message.ts";
import { type Attachment, buildMessage, toRaw } from "../mime.ts";
import { base64UrlToBytes, type Env, MailError } from "../util.ts";
import { FORWARD_ATTACHMENT_LIMIT, forwardBody, replyDraft, replyMessage } from "./compose.ts";
import type { ChangeResult, Compose, FullMessage, MailProvider, MessageSummary } from "./types.ts";

// Gmail through its REST API. Labels are Gmail labels; search is Gmail's own.

const GMAIL_UPLOAD_API = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
// Above this, messages go through Gmail's upload endpoint instead of JSON.
const RAW_JSON_LIMIT = 4 * 1024 * 1024;
const SUMMARY_HEADERS = ["From", "To", "Cc", "Subject", "Date"];
const NATIVE_ID = /^[A-Za-z0-9_-]{1,100}$/u;

type RequestOptions = {
  method?: string;
  query?: Record<string, string | number | string[] | undefined>;
  body?: unknown;
  /** Sends a whole RFC 822 message through Gmail's upload endpoint (for large forwards). */
  upload?: string;
  notFound?: string;
};

type GoogleApiError = { error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> } };
type Label = { id: string; name: string; type?: string };

function nativeId(id: string, what: string) {
  if (!NATIVE_ID.test(id)) throw new MailError(`Give a valid ${what}.`);
  return id;
}

export class GmailProvider implements MailProvider {
  readonly email: string;
  private readonly access: OAuthAccess;
  private readonly account: MailAccount;
  private readonly siteUrl: string;
  private labelCache: Promise<Label[]> | undefined;

  constructor(env: Env, account: MailAccount, siteUrl: string) {
    this.email = account.email;
    this.account = account;
    this.siteUrl = siteUrl;
    this.access = new OAuthAccess(env, account, siteUrl);
  }

  async request<T = Record<string, unknown>>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(`${options.upload ? GMAIL_UPLOAD_API : GMAIL_API}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
      else if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
    }
    if (options.upload) url.searchParams.set("uploadType", "media");
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.access.token(attempt > 0);
      let response: Response;
      try {
        response = await fetch(url, {
          method: options.method ?? (options.body !== undefined || options.upload ? "POST" : "GET"),
          headers: {
            Authorization: `Bearer ${token}`,
            ...(options.upload ? { "Content-Type": "message/rfc822" } : options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: options.upload ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
        });
      } catch {
        throw new MailError("Gmail is unreachable right now. Try again in a moment.");
      }
      // A cached token Google no longer accepts: refresh once and retry.
      if (response.status === 401 && attempt === 0) continue;
      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      const failure = ((await response.json().catch(() => ({}))) as GoogleApiError).error;
      const reason = failure?.errors?.[0]?.reason ?? "";
      // Rejected even with a fresh token; the grant itself was fine a moment ago.
      if (response.status === 401) {
        throw new MailError(`Gmail didn't accept Vox Mail's access. Try again; if it keeps failing, reconnect ${this.email} at ${this.siteUrl}`);
      }
      if (response.status === 429 || /rateLimit/iu.test(reason)) throw new MailError("Gmail is rate-limiting requests. Try again in a minute.");
      if (response.status === 403 && /insufficient|scope/iu.test(`${reason} ${failure?.message ?? ""}`)) {
        throw reconnectError(this.account, this.siteUrl, "Vox Mail doesn't have Gmail permission for that.");
      }
      if (response.status === 403 && /accessNotConfigured|SERVICE_DISABLED/iu.test(`${reason} ${failure?.status ?? ""}`)) {
        throw new MailError("The Gmail API isn't enabled for this site's Google Cloud project.");
      }
      if (response.status === 404) throw new MailError(options.notFound ?? "Gmail couldn't find that.");
      if (response.status === 400) throw new MailError(`Gmail rejected the request: ${(failure?.message ?? "invalid request").slice(0, 200)}`);
      console.error("Gmail request failed", response.status, path, reason);
      throw new MailError("Gmail is unavailable right now. Try again in a moment.");
    }
  }

  async check() {
    try {
      await this.request("/profile");
      return true;
    } catch {
      return !this.access.disconnected;
    }
  }

  private labels() {
    this.labelCache ??= this.request<{ labels?: Label[] }>("/labels").then((result) => result.labels ?? []);
    return this.labelCache;
  }

  private async labelNames(ids: string[] = []) {
    const shown = ids.filter((id) => id !== "UNREAD");
    if (!shown.some((id) => id.startsWith("Label_"))) return shown;
    const names = new Map((await this.labels()).map((label) => [label.id, label.name]));
    return shown.map((id) => names.get(id) ?? id);
  }

  private message(id: string, format: "full" | "metadata") {
    return this.request<GmailMessage>(`/messages/${nativeId(id, "message id")}`, {
      query: format === "metadata" ? { format, metadataHeaders: SUMMARY_HEADERS } : { format },
      notFound: "There's no email with that id.",
    });
  }

  private async summary(message: GmailMessage): Promise<MessageSummary> {
    const part = message.payload;
    return {
      id: message.id,
      threadId: message.threadId,
      from: header(part, "from"),
      to: header(part, "to"),
      cc: header(part, "cc"),
      subject: header(part, "subject"),
      date: header(part, "date"),
      time: Number(message.internalDate ?? 0) || Date.parse(header(part, "date")) || 0,
      snippet: decodeEntities(message.snippet ?? ""),
      labels: await this.labelNames(message.labelIds),
      unread: Boolean(message.labelIds?.includes("UNREAD")),
    };
  }

  private async full(message: GmailMessage): Promise<FullMessage> {
    const part = message.payload;
    return {
      ...(await this.summary(message)),
      body: messageText(part),
      attachments: listAttachments(part).map(({ filename, mimeType, size }) => ({ filename, mimeType, size })),
      replyTo: header(part, "reply-to"),
      messageId: header(part, "message-id"),
      references: header(part, "references"),
    };
  }

  private async summaries(ids: string[]) {
    const messages = await Promise.all(ids.map((id) => this.message(id, "metadata")));
    return Promise.all(messages.map((message) => this.summary(message)));
  }

  async search(query: string, max: number, pageToken?: string) {
    const result = await this.request<{ messages?: Array<{ id: string }>; nextPageToken?: string }>("/messages", {
      query: { q: query.trim(), maxResults: max, pageToken },
    });
    return { messages: await this.summaries((result.messages ?? []).map((message) => message.id)), next: result.nextPageToken };
  }

  async read(id: string) {
    return this.full(await this.message(id, "full"));
  }

  async thread(id: string) {
    const thread = await this.request<{ messages?: GmailMessage[] }>(`/threads/${nativeId(id, "thread id")}`, {
      query: { format: "full" },
      notFound: "There's no conversation with that id.",
    });
    return Promise.all((thread.messages ?? []).map((message) => this.full(message)));
  }

  async folders() {
    const labels = await this.labels();
    return {
      kind: "labels",
      system: labels.filter((label) => label.type !== "user").map((label) => label.name),
      own: labels.filter((label) => label.type === "user").map((label) => label.name).sort(),
    };
  }

  async unread(max: number) {
    const [inbox, list] = await Promise.all([
      this.request<{ messagesUnread?: number }>("/labels/INBOX"),
      this.request<{ messages?: Array<{ id: string }> }>("/messages", { query: { q: "is:unread in:inbox", maxResults: max } }),
    ]);
    return { count: inbox.messagesUnread ?? 0, latest: await this.summaries((list.messages ?? []).map((message) => message.id)) };
  }

  /** Sends a built message; large ones go through the upload endpoint. */
  private async deliver(message: string, threadId?: string) {
    if (message.length > RAW_JSON_LIMIT) {
      if (threadId) throw new MailError("That message is too large to send as a reply.");
      return this.request<{ id: string; threadId: string }>("/messages/send", { upload: message });
    }
    return this.request<{ id: string; threadId: string }>("/messages/send", { body: { raw: toRaw(message), ...(threadId ? { threadId } : {}) } });
  }

  async createDraft(input: Compose, replyToId?: string) {
    const original = replyToId ? await this.read(replyToId) : null;
    const outgoing = original ? replyDraft(original, this.email, input) : input;
    const message = buildMessage(outgoing);
    if (message.length > RAW_JSON_LIMIT) throw new MailError("That draft is too long.");
    const draft = await this.request<{ id: string }>("/drafts", {
      body: { message: { raw: toRaw(message), ...(original ? { threadId: original.threadId } : {}) } },
    });
    return { id: draft.id, to: outgoing.to, cc: outgoing.cc ?? [], bcc: outgoing.bcc ?? [], subject: outgoing.subject };
  }

  async send(input: Compose) {
    return this.deliver(buildMessage(input));
  }

  async reply(id: string, body: string, replyAll: boolean) {
    const original = await this.read(id);
    const outgoing = replyMessage(original, this.email, body, replyAll);
    if (!outgoing.to.length) throw new MailError("That email has no address to reply to.");
    const sent = await this.deliver(buildMessage(outgoing), original.threadId);
    return { to: outgoing.to, cc: outgoing.cc ?? [], subject: outgoing.subject, id: sent.id };
  }

  async forward(id: string, to: Compose["to"], note: string) {
    const message = await this.message(id, "full");
    const original = await this.full(message);
    const found = listAttachments(message.payload);
    const total = found.reduce((sum, item) => sum + item.size, 0);
    const attachments: Attachment[] = [];
    if (total <= FORWARD_ATTACHMENT_LIMIT) {
      for (const item of found) {
        const data = item.attachmentId
          ? (
              await this.request<{ data?: string }>(`/messages/${message.id}/attachments/${encodeURIComponent(item.attachmentId)}`, {
                notFound: "An attachment of that email is no longer available.",
              })
            ).data
          : item.data;
        attachments.push({ filename: item.filename, mimeType: item.mimeType, data: base64UrlToBytes(data ?? "") });
      }
    }
    const { subject, body } = forwardBody(original, note);
    await this.deliver(buildMessage({ to, subject, body, attachments }));
    return { subject, attachments: attachments.length, skippedBytes: found.length && !attachments.length ? total : 0 };
  }

  async sendDraft(id: string) {
    const draftId = nativeId(id, "draft id");
    const draft = await this.request<{ id: string; message?: GmailMessage }>(`/drafts/${draftId}`, {
      query: { format: "metadata" },
      notFound: "There's no draft with that id.",
    });
    const part = draft.message?.payload;
    if (!header(part, "to") && !header(part, "cc") && !header(part, "bcc")) throw new MailError("That draft has no recipients yet.");
    await this.request("/drafts/send", { body: { id: draftId } });
    return { to: header(part, "to"), subject: header(part, "subject") };
  }

  /** Label names (any case), ids, or a few aliases, to label ids. */
  private async resolveLabels(names: string[]) {
    const labels = await this.labels();
    const aliases: Record<string, string> = { star: "STARRED", starred: "STARRED", flagged: "STARRED", read: "UNREAD", archive: "INBOX", junk: "SPAM" };
    return names.map((item) => {
      const key = item.trim().toLowerCase();
      const found = labels.find((label) => label.id.toLowerCase() === key || label.name.toLowerCase() === key);
      const id = found?.id ?? (aliases[key] && labels.some((label) => label.id === aliases[key]) ? aliases[key] : undefined);
      if (!id) {
        const own = labels.filter((label) => label.type === "user").map((label) => label.name).slice(0, 30);
        throw new MailError(`${this.email} has no label called "${item.slice(0, 60)}".${own.length ? ` Its labels: ${own.join(", ")}.` : ""}`);
      }
      if (id === "TRASH") throw new MailError("Use trash_email or untrash_email for Trash.");
      return id;
    });
  }

  async modify(ids: string[], add: string[], remove: string[]) {
    const addIds = await this.resolveLabels(add);
    const removeIds = await this.resolveLabels(remove);
    await this.request("/messages/batchModify", {
      body: { ids: ids.map((id) => nativeId(id, "message id")), addLabelIds: addIds, removeLabelIds: removeIds },
    });
    const names = async (labelIds: string[]) =>
      (await this.labelNames(labelIds.filter((id) => id !== "UNREAD"))).concat(labelIds.includes("UNREAD") ? ["UNREAD"] : []);
    return { added: await names(addIds), removed: await names(removeIds) };
  }

  private async change(ids: string[], action: "trash" | "untrash"): Promise<ChangeResult[]> {
    const results = await Promise.allSettled(
      ids.map((id) => this.request(`/messages/${nativeId(id, "message id")}/${action}`, { method: "POST", notFound: "There's no email with that id." })),
    );
    return results.map((result, index) => ({
      id: ids[index],
      ok: result.status === "fulfilled",
      error: result.status === "rejected" ? (result.reason instanceof MailError ? result.reason.message : "failed") : undefined,
    }));
  }

  trash(ids: string[]) {
    return this.change(ids, "trash");
  }

  untrash(ids: string[]) {
    return this.change(ids, "untrash");
  }
}
