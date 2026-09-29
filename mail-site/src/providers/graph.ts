import type { MailAccount } from "../accounts.ts";
import { GRAPH_API, OAuthAccess, reconnectError } from "../connect.ts";
import { htmlToText } from "../message.ts";
import { type Address, replyRecipients, replySubject } from "../mime.ts";
import { parseQuery } from "../query.ts";
import { type Env, MailError } from "../util.ts";
import type { ChangeResult, Compose, FullMessage, MailProvider, MessageSummary } from "./types.ts";

// Outlook.com and Microsoft 365 through Microsoft Graph. Folders and
// categories stand in for labels; flags stand in for stars. Immutable ids keep
// a message's id the same when it moves between folders.

const NATIVE_ID = /^[A-Za-z0-9_=+/-]{1,400}$/u;
const SUMMARY_FIELDS = "id,conversationId,subject,from,toRecipients,ccRecipients,replyTo,receivedDateTime,isRead,flag,categories,importance,bodyPreview,parentFolderId,internetMessageId,hasAttachments,isDraft";
const WELL_KNOWN: Record<string, string> = {
  inbox: "inbox",
  sent: "sentitems",
  drafts: "drafts",
  draft: "drafts",
  trash: "deleteditems",
  spam: "junkemail",
  junk: "junkemail",
  archive: "archive",
};

type Recipient = { emailAddress?: { name?: string; address?: string } };
type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  bccRecipients?: Recipient[];
  replyTo?: Recipient[];
  receivedDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  flag?: { flagStatus?: string };
  categories?: string[];
  importance?: string;
  bodyPreview?: string;
  parentFolderId?: string;
  internetMessageId?: string;
  hasAttachments?: boolean;
  body?: { contentType?: string; content?: string };
};
type Folder = { id: string; displayName: string; wellKnownName?: string };

type RequestOptions = { method?: string; body?: unknown; notFound?: string; text?: boolean };

function nativeId(id: string, what: string) {
  if (!NATIVE_ID.test(id)) throw new MailError(`Give a valid ${what}.`);
  return encodeURIComponent(id);
}

function recipient(value: Recipient | undefined) {
  const address = value?.emailAddress?.address ?? "";
  const name = value?.emailAddress?.name ?? "";
  return name && name !== address ? `${name} <${address}>` : address;
}

function recipients(values: Recipient[] | undefined) {
  return (values ?? []).map(recipient).filter(Boolean).join(", ");
}

function toRecipients(addresses: Address[]) {
  return addresses.map((address) => ({ emailAddress: { address: address.email, ...(address.name ? { name: address.name } : {}) } }));
}

/** Words for KQL, without the quotes and backslashes that would break $search. */
function kqlWords(value: string) {
  return value.replace(/["\\]/gu, " ").split(/\s+/u).filter(Boolean);
}

export class GraphProvider implements MailProvider {
  readonly email: string;
  private readonly access: OAuthAccess;
  private readonly account: MailAccount;
  private readonly siteUrl: string;
  private folderCache: Promise<Folder[]> | undefined;
  private categoryCache: Promise<string[]> | undefined;

  constructor(env: Env, account: MailAccount, siteUrl: string) {
    this.email = account.email;
    this.account = account;
    this.siteUrl = siteUrl;
    this.access = new OAuthAccess(env, account, siteUrl);
  }

  async request<T = Record<string, unknown>>(pathOrUrl: string, options: RequestOptions = {}): Promise<T> {
    const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${GRAPH_API}${pathOrUrl}`;
    for (let attempt = 0; ; attempt += 1) {
      const token = await this.access.token(attempt > 0);
      let response: Response;
      try {
        response = await fetch(url, {
          method: options.method ?? (options.body !== undefined ? "POST" : "GET"),
          headers: {
            Authorization: `Bearer ${token}`,
            Prefer: `IdType="ImmutableId", outlook.body-content-type="text"`,
            ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
      } catch {
        throw new MailError("Outlook is unreachable right now. Try again in a moment.");
      }
      if (response.status === 401 && attempt === 0) continue;
      if (response.ok) {
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
      }
      const failure = ((await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }).error;
      if (response.status === 401) {
        throw new MailError(`Outlook didn't accept Vox Mail's access. Try again; if it keeps failing, reconnect ${this.email} at ${this.siteUrl}`);
      }
      if (response.status === 429) throw new MailError("Outlook is rate-limiting requests. Try again in a minute.");
      if (response.status === 403) throw reconnectError(this.account, this.siteUrl, "Vox Mail doesn't have Outlook permission for that.");
      if (response.status === 404) {
        if (failure?.code === "MailboxNotEnabledForRESTAPI") throw new MailError(`${this.email} has no Outlook mailbox.`);
        throw new MailError(options.notFound ?? "Outlook couldn't find that.");
      }
      if (response.status === 400) throw new MailError(`Outlook rejected the request: ${(failure?.message ?? "invalid request").slice(0, 200)}`);
      console.error("Graph request failed", response.status, failure?.code);
      throw new MailError("Outlook is unavailable right now. Try again in a moment.");
    }
  }

  async check() {
    try {
      await this.request("/me?$select=id");
      return true;
    } catch {
      return !this.access.disconnected;
    }
  }

  private folders_() {
    this.folderCache ??= this.request<{ value?: Folder[] }>("/me/mailFolders?$top=100&$select=id,displayName,wellKnownName").then((result) => result.value ?? []);
    return this.folderCache;
  }

  private categories() {
    this.categoryCache ??= this.request<{ value?: Array<{ displayName: string }> }>("/me/outlook/masterCategories")
      .then((result) => (result.value ?? []).map((category) => category.displayName))
      .catch(() => []);
    return this.categoryCache;
  }

  private async summary(message: GraphMessage): Promise<MessageSummary> {
    const folder = (await this.folders_()).find((item) => item.id === message.parentFolderId)?.displayName;
    const labels = [
      ...(folder ? [folder] : []),
      ...(message.flag?.flagStatus === "flagged" ? ["STARRED"] : []),
      ...(message.importance === "high" ? ["IMPORTANT"] : []),
      ...(message.categories ?? []),
    ];
    return {
      id: message.id,
      threadId: message.conversationId ?? "",
      from: recipient(message.from),
      to: recipients(message.toRecipients),
      cc: recipients(message.ccRecipients),
      subject: message.subject ?? "",
      date: message.receivedDateTime ?? "",
      time: Date.parse(message.receivedDateTime ?? "") || 0,
      snippet: message.bodyPreview ?? "",
      labels,
      unread: message.isRead === false,
    };
  }

  private async full(message: GraphMessage): Promise<FullMessage> {
    const attachments = message.hasAttachments
      ? ((await this.request<{ value?: Array<{ name?: string; size?: number; contentType?: string }> }>(
          `/me/messages/${nativeId(message.id, "message id")}/attachments?$select=name,size,contentType`,
        )).value ?? []).map((item) => ({ filename: item.name ?? "attachment", mimeType: item.contentType ?? "", size: item.size ?? 0 }))
      : [];
    const content = message.body?.content ?? "";
    return {
      ...(await this.summary(message)),
      body: message.body?.contentType?.toLowerCase() === "html" ? htmlToText(content) : content.trim(),
      attachments,
      replyTo: recipients(message.replyTo),
      messageId: message.internetMessageId ?? "",
      references: "",
    };
  }

  private async folderPath(name: string | undefined) {
    if (!name) return "/me/messages";
    const key = name.toLowerCase();
    if (WELL_KNOWN[key]) return `/me/mailFolders/${WELL_KNOWN[key]}/messages`;
    const folder = (await this.folders_()).find((item) => item.displayName.toLowerCase() === key);
    if (!folder) throw new MailError(`${this.email} has no folder called "${name.slice(0, 60)}".`);
    return `/me/mailFolders/${encodeURIComponent(folder.id)}/messages`;
  }

  async search(query: string, max: number, pageToken?: string) {
    let url: string;
    const parsed = parseQuery(query);
    if (pageToken) {
      // Only Graph's own next links, for this user's mail.
      if (!pageToken.startsWith(`${GRAPH_API}/me/`)) throw new MailError("That page_token isn't valid.");
      url = pageToken;
    } else {
      const kql = [
        ...parsed.from.flatMap(kqlWords).map((word) => `from:${word}`),
        ...parsed.to.flatMap(kqlWords).map((word) => `to:${word}`),
        ...parsed.subject.flatMap(kqlWords).map((word) => `subject:${word}`),
        ...parsed.text.flatMap(kqlWords),
        ...(parsed.hasAttachment ? ["hasattachments:true"] : []),
      ];
      const base = `${await this.folderPath(parsed.folder)}?$select=${SUMMARY_FIELDS}`;
      if (kql.length) {
        // $search can't be combined with $filter; dates go into KQL, read and flag state is filtered here.
        if (parsed.after) kql.push(`received>=${parsed.after.toISOString().slice(0, 10)}`);
        if (parsed.before) kql.push(`received<${parsed.before.toISOString().slice(0, 10)}`);
        const top = parsed.unread !== undefined || parsed.starred !== undefined ? Math.min(50, max * 3) : max;
        url = `${base}&$top=${top}&$search=${encodeURIComponent(`"${kql.join(" ")}"`)}`;
      } else {
        // Graph requires the $orderby property to lead the $filter.
        const filter = [`receivedDateTime ge ${(parsed.after ?? new Date("1900-01-01T00:00:00Z")).toISOString()}`];
        if (parsed.before) filter.push(`receivedDateTime lt ${parsed.before.toISOString()}`);
        if (parsed.unread !== undefined) filter.push(`isRead eq ${!parsed.unread}`);
        if (parsed.starred !== undefined) filter.push(`flag/flagStatus ${parsed.starred ? "eq" : "ne"} 'flagged'`);
        url = `${base}&$top=${max}&$orderby=receivedDateTime desc&$filter=${encodeURIComponent(filter.join(" and "))}`;
      }
    }
    const result = await this.request<{ value?: GraphMessage[]; "@odata.nextLink"?: string }>(url);
    const matching = (result.value ?? []).filter(
      (message) =>
        (parsed.unread === undefined || (message.isRead === false) === parsed.unread) &&
        (parsed.starred === undefined || (message.flag?.flagStatus === "flagged") === parsed.starred),
    );
    return { messages: await Promise.all(matching.slice(0, max).map((message) => this.summary(message))), next: result["@odata.nextLink"] };
  }

  private message(id: string, fields = `${SUMMARY_FIELDS},body`) {
    return this.request<GraphMessage>(`/me/messages/${nativeId(id, "message id")}?$select=${fields}`, { notFound: "There's no email with that id." });
  }

  async read(id: string) {
    return this.full(await this.message(id));
  }

  async thread(id: string) {
    if (!NATIVE_ID.test(id)) throw new MailError("Give a valid thread id.");
    const filter = encodeURIComponent(`conversationId eq '${id.replace(/'/gu, "''")}'`);
    const result = await this.request<{ value?: GraphMessage[] }>(`/me/messages?$select=${SUMMARY_FIELDS},body&$top=50&$filter=${filter}`);
    const messages = await Promise.all((result.value ?? []).map((message) => this.full(message)));
    if (!messages.length) throw new MailError("There's no conversation with that id.");
    return messages.sort((a, b) => a.time - b.time);
  }

  async folders() {
    const [folders, categories] = await Promise.all([this.folders_(), this.categories()]);
    const system = folders.filter((folder) => folder.wellKnownName).map((folder) => folder.displayName);
    const own = folders.filter((folder) => !folder.wellKnownName).map((folder) => folder.displayName);
    return { kind: "folders and categories", system, own: [...own.sort(), ...categories.map((name) => `${name} (category)`)] };
  }

  async unread(max: number) {
    const [inbox, list] = await Promise.all([
      this.request<{ unreadItemCount?: number }>("/me/mailFolders/inbox?$select=unreadItemCount"),
      this.request<{ value?: GraphMessage[] }>(
        `/me/mailFolders/inbox/messages?$select=${SUMMARY_FIELDS}&$top=${max}&$orderby=receivedDateTime desc&$filter=${encodeURIComponent("receivedDateTime ge 1900-01-01T00:00:00Z and isRead eq false")}`,
      ),
    ]);
    return { count: inbox.unreadItemCount ?? 0, latest: await Promise.all((list.value ?? []).map((message) => this.summary(message))) };
  }

  async createDraft(input: Compose, replyToId?: string) {
    let draft: GraphMessage;
    if (replyToId) {
      draft = await this.request<GraphMessage>(`/me/messages/${nativeId(replyToId, "message id")}/createReply`, {
        body: { comment: input.body },
        notFound: "There's no email with that id.",
      });
      const changes: Record<string, unknown> = {};
      if (input.to.length) changes.toRecipients = toRecipients(input.to);
      if (input.cc.length) changes.ccRecipients = toRecipients(input.cc);
      if (input.bcc.length) changes.bccRecipients = toRecipients(input.bcc);
      if (input.subject.trim()) changes.subject = input.subject.trim();
      if (Object.keys(changes).length) draft = await this.request<GraphMessage>(`/me/messages/${nativeId(draft.id, "draft id")}`, { method: "PATCH", body: changes });
    } else {
      draft = await this.request<GraphMessage>("/me/messages", {
        body: {
          subject: input.subject,
          body: { contentType: "Text", content: input.body },
          toRecipients: toRecipients(input.to),
          ccRecipients: toRecipients(input.cc),
          bccRecipients: toRecipients(input.bcc),
        },
      });
    }
    const addresses = (values: Recipient[] | undefined) => (values ?? []).map((value) => ({ name: value.emailAddress?.name ?? "", email: value.emailAddress?.address ?? "" }));
    return { id: draft.id, to: addresses(draft.toRecipients), cc: addresses(draft.ccRecipients), bcc: addresses(draft.bccRecipients), subject: draft.subject ?? input.subject };
  }

  async send(input: Compose) {
    await this.request("/me/sendMail", {
      body: {
        message: {
          subject: input.subject,
          body: { contentType: "Text", content: input.body },
          toRecipients: toRecipients(input.to),
          ccRecipients: toRecipients(input.cc),
          bccRecipients: toRecipients(input.bcc),
        },
        saveToSentItems: true,
      },
    });
    return {};
  }

  async reply(id: string, body: string, replyAll: boolean) {
    const original = await this.read(id);
    const { to, cc } = replyRecipients(original, this.email, replyAll);
    if (!to.length) throw new MailError("That email has no address to reply to.");
    // Graph threads the reply and quotes the original itself.
    await this.request(`/me/messages/${nativeId(id, "message id")}/${replyAll ? "replyAll" : "reply"}`, { body: { comment: body } });
    return { to, cc, subject: replySubject(original.subject) };
  }

  async forward(id: string, to: Address[], note: string) {
    const original = await this.read(id);
    await this.request(`/me/messages/${nativeId(id, "message id")}/forward`, { body: { comment: note, toRecipients: toRecipients(to) } });
    return { subject: `FW: ${original.subject}`, attachments: original.attachments.length, skippedBytes: 0 };
  }

  async sendDraft(id: string) {
    const draft = await this.message(id, "subject,toRecipients,ccRecipients,bccRecipients,isDraft");
    if (!draft.isDraft) throw new MailError("That email isn't a draft.");
    if (!draft.toRecipients?.length && !draft.ccRecipients?.length && !draft.bccRecipients?.length) throw new MailError("That draft has no recipients yet.");
    await this.request(`/me/messages/${nativeId(id, "draft id")}/send`, { method: "POST" });
    return { to: recipients(draft.toRecipients), subject: draft.subject ?? "" };
  }

  /**
   * Gmail-style label changes in Outlook terms: UNREAD is the read state,
   * STARRED the flag, IMPORTANT the importance, INBOX/SPAM/ARCHIVE and
   * folder names are moves, and anything else is a category.
   */
  async modify(ids: string[], add: string[], remove: string[]) {
    const [folders, categories] = await Promise.all([this.folders_(), this.categories()]);
    const patch: Record<string, unknown> = {};
    const addCategories: string[] = [];
    const removeCategories: string[] = [];
    let destination: string | undefined;
    const move = (target: string) => {
      if (destination && destination !== target) throw new MailError("Move emails to one folder at a time.");
      destination = target;
    };
    const apply = (name: string, adding: boolean) => {
      const key = name.trim().toLowerCase();
      if (key === "unread" || key === "read") patch.isRead = key === "unread" ? !adding : adding;
      else if (key === "starred" || key === "star" || key === "flagged") patch.flag = { flagStatus: adding ? "flagged" : "notFlagged" };
      else if (key === "important") patch.importance = adding ? "high" : "normal";
      else if (key === "trash" || key === "deleted items") throw new MailError("Use trash_email or untrash_email for Trash.");
      else if (key === "inbox") move(adding ? "inbox" : "archive");
      else if (key === "spam" || key === "junk" || key === "junk email") move(adding ? "junkemail" : "inbox");
      else if (key === "archive") move(adding ? "archive" : "inbox");
      else {
        const folder = folders.find((item) => item.displayName.toLowerCase() === key);
        const category = categories.find((item) => item.toLowerCase() === key);
        if (category) (adding ? addCategories : removeCategories).push(category);
        else if (folder) move(adding ? folder.id : "inbox");
        else {
          const own = [...folders.filter((item) => !item.wellKnownName).map((item) => item.displayName), ...categories];
          throw new MailError(`${this.email} has no folder or category called "${name.slice(0, 60)}".${own.length ? ` Its folders and categories: ${own.slice(0, 30).join(", ")}.` : ""}`);
        }
      }
    };
    for (const name of add) apply(name, true);
    for (const name of remove) apply(name, false);
    for (const id of ids) {
      const path = `/me/messages/${nativeId(id, "message id")}`;
      const changes = { ...patch };
      if (addCategories.length || removeCategories.length) {
        const current = (await this.request<GraphMessage>(`${path}?$select=categories`, { notFound: "There's no email with that id." })).categories ?? [];
        changes.categories = [...new Set([...current, ...addCategories])].filter((item) => !removeCategories.includes(item));
      }
      if (Object.keys(changes).length) await this.request(path, { method: "PATCH", body: changes, notFound: "There's no email with that id." });
      if (destination) await this.request(`${path}/move`, { body: { destinationId: destination }, notFound: "There's no email with that id." });
    }
    return { added: add, removed: remove };
  }

  private async moveAll(ids: string[], destinationId: string): Promise<ChangeResult[]> {
    const results = await Promise.allSettled(
      ids.map((id) => this.request(`/me/messages/${nativeId(id, "message id")}/move`, { body: { destinationId }, notFound: "There's no email with that id." })),
    );
    return results.map((result, index) => ({
      id: ids[index],
      ok: result.status === "fulfilled",
      error: result.status === "rejected" ? (result.reason instanceof MailError ? result.reason.message : "failed") : undefined,
    }));
  }

  trash(ids: string[]) {
    return this.moveAll(ids, "deleteditems");
  }

  /** Outlook doesn't remember where a message came from, so it goes back to the inbox. */
  untrash(ids: string[]) {
    return this.moveAll(ids, "inbox");
  }
}
