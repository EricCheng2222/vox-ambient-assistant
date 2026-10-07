import { requireUser } from "@/lib/auth";
import { callMcpTools, type McpToolResult } from "@/lib/mcp-call";
import { flashcardsServerUrl, mailServerUrl } from "@/lib/mcp-client";
import type { TodayBriefing, TodayCalendar, TodayFlashcards, TodayMail, TodayMoment, TodayTasks } from "@/lib/today";
import { askJev } from "@/lib/today-jev";
import { buildCandidates, chooseMoments, triageUnread } from "@/lib/today-moments";
import {
  calendarPart,
  cleanText,
  parseFlashcardDecks,
  parseMailAccounts,
  parseUnreadJson,
  parseUnreadSummary,
  tasksPart,
} from "@/lib/today-parse";
import { categorizeUnread, type MailCategory } from "@/lib/mail-category";
import { loadMailCategories, loadMailVerdicts, loadNowDecision, saveMailCategories, saveMailVerdicts, saveNowDecision, signatureDigest } from "@/lib/today-store";
import { localClock, validTimeZone } from "@/lib/today-time";

// The Today briefing: unread email, calendar, and tasks from Vox Mail, due
// flash cards from Vox Flash Cards, and `now`, the few things worth attention
// at this moment. JEV decides which emails matter and what belongs in `now`.
// Each part is read on its own; one failing never fails the others.

type Settled = PromiseSettledResult<McpToolResult>;

function failure(result: Settled, fallback: string) {
  if (result.status === "rejected") return result.reason instanceof Error ? result.reason.message : fallback;
  // Tool errors come from the server itself (not from email content).
  return result.value.isError ? cleanText(result.value.text, 200) || fallback : null;
}

/** JEV's pick of the unread messages; the newest few if that fails outright. */
async function importantUnread(ownerId: string, messages: Parameters<typeof triageUnread>[0]): Promise<TodayMail["unread"]> {
  return triageUnread(messages, {
    ask: askJev,
    loadVerdicts: (ids) => loadMailVerdicts(ownerId, ids),
    saveVerdicts: (verdicts) => saveMailVerdicts(ownerId, verdicts),
  });
}

/** The messages worth showing, and the rest of the newest unread for "show others". */
async function unreadSplit(ownerId: string, messages: Parameters<typeof triageUnread>[0]) {
  const [important, categories] = await Promise.all([
    importantUnread(ownerId, messages),
    categorizeUnread(messages, {
      ask: askJev,
      load: (ids) => loadMailCategories(ownerId, ids),
      save: (sorted) => saveMailCategories(ownerId, sorted),
    }).catch(() => new Map<string, MailCategory>()),
  ]);
  const tagged = <T extends { id: string }>(message: T) => {
    const category = categories.get(message.id);
    return category ? { ...message, category } : message;
  };
  const unread = important.map(tagged);
  const shown = new Set(unread.map((message) => message.id));
  const other = messages
    .filter((message) => !shown.has(message.id))
    .slice(0, 15)
    .map((message) => tagged({ id: message.id, from: message.from, subject: message.subject, account: message.account, date: message.date }));
  return { unread, other };
}

async function mailPart(ownerId: string, accountsResult: Settled, unreadResult: Settled): Promise<TodayMail> {
  const empty: TodayMail = { connected: true, accounts: [], unreadCount: null, unread: [] };
  const accounts = accountsResult.status === "fulfilled" && !accountsResult.value.isError
    ? parseMailAccounts(accountsResult.value.text)
    : null;
  // No accounts on the mail site yet: nothing is unread, and unread_summary
  // reports that as an error.
  if (accounts?.length === 0) return { ...empty, unreadCount: 0 };
  const text = unreadResult.status === "fulfilled" && !unreadResult.value.isError ? unreadResult.value.text : null;
  const json = text === null ? null : parseUnreadJson(text);
  if (json) {
    return {
      ...empty,
      accounts: accounts ?? json.accounts,
      unreadCount: json.unreadCount,
      ...(await unreadSplit(ownerId, json.messages)),
    };
  }
  // An older mail server answers in text, without the snippets JEV judges by.
  const summary = text === null ? null : parseUnreadSummary(text);
  const mail: TodayMail = {
    ...empty,
    accounts: accounts ?? summary?.accounts ?? [],
    unreadCount: summary?.unreadCount ?? null,
    unread: (summary?.unread ?? []).map((message) => ({ ...message, importance: "worth_reading" as const })),
  };
  if (!summary) {
    mail.error =
      failure(unreadResult, "Vox Mail could not be read.") ??
      "Vox Mail answered in a way Vox could not read.";
  }
  return mail;
}

/** Email, calendar, and tasks: one round of calls to Vox Mail. */
async function readMailSite(ownerId: string, now: Date, timeZone: string): Promise<{ mail: TodayMail; calendar: TodayCalendar; tasks: TodayTasks }> {
  const mail: TodayMail = { connected: true, accounts: [], unreadCount: null, unread: [] };
  let results: Settled[] | null;
  try {
    results = await callMcpTools(ownerId, mailServerUrl(), [
      { name: "list_accounts" },
      { name: "unread_summary", args: { format: "json" } },
      {
        name: "list_events",
        args: { from: now.toISOString(), to: new Date(now.getTime() + 36 * 60 * 60_000).toISOString(), max: 12, format: "json" },
      },
      { name: "list_tasks", args: { format: "json" } },
    ]);
  } catch (error) {
    console.error("Today: mail failed", error instanceof Error ? error.message : "unknown");
    const unreachable = "Vox Mail could not be reached.";
    return {
      mail: { ...mail, error: unreachable },
      calendar: { connected: true, error: unreachable, events: [] },
      tasks: { connected: true, error: unreachable, items: [] },
    };
  }
  if (!results) {
    return {
      mail: { ...mail, connected: false },
      calendar: { connected: false, events: [] },
      tasks: { connected: false, items: [] },
    };
  }
  const [accountsResult, unreadResult, eventsResult, tasksResult] = results;
  // No account on the mail site at all: there is no Google account either.
  const noAccounts =
    accountsResult.status === "fulfilled" && !accountsResult.value.isError && parseMailAccounts(accountsResult.value.text)?.length === 0;
  return {
    mail: await mailPart(ownerId, accountsResult, unreadResult).catch((error) => {
      console.error("Today: mail failed", error instanceof Error ? error.message : "unknown");
      return { ...mail, error: "Vox Mail could not be read." };
    }),
    calendar: noAccounts ? { connected: false, events: [] } : calendarPart(eventsResult, now, timeZone),
    tasks: noAccounts ? { connected: false, items: [] } : tasksPart(tasksResult, now, timeZone),
  };
}

async function readFlashcards(ownerId: string): Promise<TodayFlashcards> {
  const empty: TodayFlashcards = { connected: true, decks: [], totalDue: null };
  try {
    const results = await callMcpTools(ownerId, flashcardsServerUrl(), [{ name: "list_decks" }]);
    if (!results) return { ...empty, connected: false };
    const [result] = results;
    const parsed = result.status === "fulfilled" && !result.value.isError ? parseFlashcardDecks(result.value.text) : null;
    if (!parsed) {
      return {
        ...empty,
        error:
          failure(result, "Vox Flash Cards could not be read.") ??
          "Vox Flash Cards answered in a way Vox could not read.",
      };
    }
    return { ...empty, ...parsed };
  } catch (error) {
    console.error("Today: flash cards failed", error instanceof Error ? error.message : "unknown");
    return { ...empty, error: "Vox Flash Cards could not be reached." };
  }
}

/** The few things worth attention now; nothing rather than an error. */
async function chooseNow(ownerId: string, parts: Parameters<typeof buildCandidates>[0], now: Date, timeZone: string): Promise<TodayMoment[]> {
  try {
    return await chooseMoments(buildCandidates(parts, now, timeZone), localClock(now, timeZone), {
      ask: askJev,
      digest: signatureDigest,
      loadDecision: () => loadNowDecision(ownerId),
      saveDecision: (decision) => saveNowDecision(ownerId, decision),
    });
  } catch (error) {
    console.error("Today: now failed", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if ("response" in auth) return auth.response;
  // The user's own zone decides what "today" and "overdue" mean.
  const timeZone = validTimeZone(new URL(request.url).searchParams.get("tz"));
  const now = new Date();
  const [mailSite, flashcards] = await Promise.all([readMailSite(auth.user.id, now, timeZone), readFlashcards(auth.user.id)]);
  const briefing: TodayBriefing = {
    ...mailSite,
    flashcards,
    now: await chooseNow(auth.user.id, { ...mailSite, flashcards }, now, timeZone),
    generatedAt: now.toISOString(),
  };
  return Response.json(briefing, { headers: { "Cache-Control": "no-store" } });
}
