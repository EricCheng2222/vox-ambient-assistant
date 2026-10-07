import type { Initiative } from "@/lib/preferences";
import type { TodayBriefing } from "@/lib/today";

import {
  briefingDue,
  briefingReadable,
  buildNudgeRequest,
  buildWriterRequest,
  composeNudge,
  decideNudges,
  eveningSummary,
  fallbackBriefingText,
  finalizeText,
  hasSomethingToSay,
  keyId,
  KEY_TOUCH_MS,
  KEY_TTL_MS,
  MAX_NUDGE_CANDIDATES,
  MAX_TEXT_CHARS,
  morningSummary,
  notebookSummary,
  nudgeAllowance,
  nudgeCandidates,
  phaseAt,
  readWriterText,
  type EveningSummary,
  type MorningSummary,
  type NudgeCandidate,
  type TextKind,
  type TextLogRow,
  type TextStatus,
} from "./proactive-texts.ts";
import type { ResponseLanguage } from "./response-language.ts";
import type { AskJev } from "./today-moments.ts";
import { localClock } from "./today-time.ts";

// The background check behind "Vox reaches you when it's closed", run every
// 15 minutes by the Worker's cron. For each account that may be texted it
// works out whether a morning briefing, an evening review, or a nudge is due,
// and sends at most one text. What to send is decided in
// lib/proactive-texts.ts; everything that touches the outside world (the
// database, the briefing, JEV, the model, Twilio) is passed in, so this file
// runs the same in a test as in the Worker.

/** What became of a thing the check has seen. */
export type KeyStatus = "sent" | "briefed" | "wait" | "never";

export type ProactiveTextStore = {
  /** Stored rows for these key ids: when each was last seen. */
  loadKeys(ownerId: string, ids: string[]): Promise<Map<string, { seenAt: string }>>;
  /**
   * Stores these keys unless they are stored already and returns the ids it
   * did store. Whoever gets an id back owns that thing: nobody else texts it.
   */
  claimKeys(ownerId: string, keys: Array<{ id: string; kind: string; status: KeyStatus }>, nowIso: string): Promise<string[]>;
  /** Gives claimed keys back after a send that failed, so they are tried again. */
  releaseKeys(ownerId: string, ids: string[]): Promise<void>;
  /** Marks keys as still around, and drops the owner's keys not seen since `pruneBeforeIso`. */
  touchKeys(ownerId: string, ids: string[], nowIso: string, pruneBeforeIso: string): Promise<void>;
  /** The owner's send log since an instant, any order. */
  recentLog(ownerId: string, sinceIso: string): Promise<TextLogRow[]>;
  /** Adds a log row; false when a row with this id exists already. */
  claimLog(row: { id: string; ownerId: string; kind: TextKind; status: TextStatus; localDay: string; items: number; createdAt: string }): Promise<boolean>;
  finishLog(id: string, status: "sent" | "error", error: string | null): Promise<void>;
};

export type SendResult = { ok: true } | { ok: false; error: string };

export type ProactiveTickDeps = {
  /** Accounts with a callback number Vox may text and proactive texts switched on. */
  listAccounts(): Promise<string[]>;
  initiative(ownerId: string): Promise<Initiative>;
  timeZone(ownerId: string): Promise<string>;
  store: ProactiveTextStore;
  buildBriefing(ownerId: string, timeZone: string, now: Date): Promise<TodayBriefing>;
  askJev: AskJev;
  /** The language the owner usually uses with Vox. */
  language(ownerId: string): Promise<ResponseLanguage>;
  /** VÉLO's get_today text; null when the owner has not connected VÉLO. */
  notebookToday(ownerId: string): Promise<string | null>;
  /** Asks the model to write a briefing or review; null when it could not. */
  write(summary: MorningSummary | EveningSummary, language: ResponseLanguage): Promise<string | null>;
  /** Texts the account's own number. There is no other recipient to give. */
  send(ownerId: string, body: string): Promise<SendResult>;
  /** Shows the text in the owner's conversation with Vox. */
  appendToConversation(ownerId: string, id: string, text: string): Promise<void>;
  /** The deployment's own address, put at the end of every text. */
  link: string | null;
  now?: Date;
  /** Accounts not reached within this time wait for the next check. */
  budgetMs?: number;
  clock?: () => number;
  maxAccounts?: number;
  newId?: () => string;
};

export type AccountOutcome =
  | { action: "sent"; kind: TextKind; items: number }
  | { action: "failed"; kind: TextKind }
  | { action: "skipped"; reason: string };

export type ProactiveTickSummary = { checked: number; sent: number; failed: number; skipped: number; errors: number; deferred: number };

export const TICK_BUDGET_MS = 90_000;
export const TICK_MAX_ACCOUNTS = 25;

function errorCode(error: unknown) {
  return (error instanceof Error ? error.message : "failed").replace(/[^\w .:-]/gu, "").slice(0, 80) || "failed";
}

type Run = { deps: ProactiveTickDeps; ownerId: string; now: Date; nowIso: string; today: string; timeZone: string };

/** Sends one text and records how it went. The log row is the claim: a text is never sent twice for one row. */
async function deliver(run: Run, kind: TextKind, logId: string, body: string, items: number): Promise<AccountOutcome> {
  const { deps, ownerId } = run;
  const claimed = await deps.store.claimLog({ id: logId, ownerId, kind, status: "sending", localDay: run.today, items, createdAt: run.nowIso });
  if (!claimed) return { action: "skipped", reason: "already_under_way" };
  const text = finalizeText(body, deps.link, MAX_TEXT_CHARS);
  const result = await deps.send(ownerId, text).catch((error): SendResult => ({ ok: false, error: errorCode(error) }));
  await deps.store.finishLog(logId, result.ok ? "sent" : "error", result.ok ? null : errorCode(new Error(result.error))).catch(() => undefined);
  if (!result.ok) return { action: "failed", kind };
  // The owner sees what was texted when they next open Vox.
  await deps.appendToConversation(ownerId, `proactive-${logId}`.replace(/[^A-Za-z0-9_-]/gu, "-").slice(0, 160), text).catch((error) => {
    console.error("Proactive text: conversation append failed", errorCode(error));
  });
  return { action: "sent", kind, items };
}

async function sendBriefing(run: Run, kind: "morning" | "evening", attempt: number, briefing: TodayBriefing, fresh: Array<{ id: string; candidate: NudgeCandidate }>): Promise<AccountOutcome> {
  const { deps, ownerId, now, timeZone } = run;
  // A source that could not be read says nothing either way: try again at the next check.
  if (!briefingReadable(briefing)) return { action: "skipped", reason: "sources_unavailable" };
  let summary: MorningSummary | EveningSummary;
  if (kind === "morning") {
    summary = morningSummary(briefing, now, timeZone);
  } else {
    const notebook = await deps.notebookToday(ownerId).then(notebookSummary, () => null);
    summary = eveningSummary(briefing, now, timeZone, notebook);
  }
  const logId = `${ownerId}:${kind}:${run.today}:${attempt}`;
  if (!hasSomethingToSay(summary)) {
    await deps.store.claimLog({ id: logId, ownerId, kind, status: "skipped", localDay: run.today, items: 0, createdAt: run.nowIso });
    return { action: "skipped", reason: "nothing_to_say" };
  }
  const language = await deps.language(ownerId).catch((): ResponseLanguage => "taiwan_mandarin");
  const budget = MAX_TEXT_CHARS - (deps.link ? deps.link.length + 1 : 0);
  const written = await deps.write(summary, language).catch(() => null);
  const body = written && written.trim() ? written : fallbackBriefingText(summary, language, budget);
  const outcome = await deliver(run, kind, logId, body, 1);
  if (outcome.action === "sent" && fresh.length) {
    // Everything open right now has been covered; none of it is nudged later.
    await deps.store
      .claimKeys(ownerId, fresh.map(({ id, candidate }) => ({ id, kind: candidate.kind, status: "briefed" as const })), run.nowIso)
      .catch(() => undefined);
  }
  return outcome;
}

async function sendNudge(run: Run, fresh: Array<{ id: string; candidate: NudgeCandidate }>): Promise<AccountOutcome> {
  const { deps, ownerId, now, timeZone } = run;
  const batch = fresh.slice(0, MAX_NUDGE_CANDIDATES);
  if (!batch.length) return { action: "skipped", reason: "nothing_new" };
  const idOf = new Map(batch.map(({ id, candidate }) => [candidate.key, id]));
  const candidates = batch.map(({ candidate }) => candidate);
  const answers = await deps.askJev(buildNudgeRequest(candidates, localClock(now, timeZone))).catch(() => null);
  const decision = decideNudges(candidates, answers);
  const settled = [
    ...decision.wait.map((candidate) => ({ id: idOf.get(candidate.key) as string, kind: candidate.kind, status: "wait" as const })),
    ...decision.never.map((candidate) => ({ id: idOf.get(candidate.key) as string, kind: candidate.kind, status: "never" as const })),
  ];
  if (settled.length) await deps.store.claimKeys(ownerId, settled, run.nowIso).catch(() => undefined);
  if (!decision.send.length) return { action: "skipped", reason: decision.undecided.length ? "undecided" : "not_worth_a_text" };

  // Claim before sending: a key stored here is never texted again.
  const claimed = new Set(
    await deps.store.claimKeys(
      ownerId,
      decision.send.map((candidate) => ({ id: idOf.get(candidate.key) as string, kind: candidate.kind, status: "sent" as const })),
      run.nowIso,
    ),
  );
  const sending = decision.send.filter((candidate) => claimed.has(idOf.get(candidate.key) as string));
  if (!sending.length) return { action: "skipped", reason: "already_under_way" };
  const language = await deps.language(ownerId).catch((): ResponseLanguage => "taiwan_mandarin");
  const budget = MAX_TEXT_CHARS - (deps.link ? deps.link.length + 1 : 0);
  const body = composeNudge(sending, now, timeZone, language, budget);
  const logId = `${ownerId}:nudge:${(deps.newId ?? (() => crypto.randomUUID()))()}`;
  const outcome = await deliver(run, "nudge", logId, body, sending.length);
  if (outcome.action !== "sent") await deps.store.releaseKeys(ownerId, [...claimed]).catch(() => undefined);
  return outcome;
}

/** One account's check: at most one text. */
export async function tickAccount(deps: ProactiveTickDeps, ownerId: string, now: Date): Promise<AccountOutcome> {
  const initiative = await deps.initiative(ownerId);
  if (initiative === "off") return { action: "skipped", reason: "initiative_off" };
  const timeZone = await deps.timeZone(ownerId);
  const clock = localClock(now, timeZone);
  const phase = phaseAt(clock);
  if (phase === "quiet") return { action: "skipped", reason: "quiet_hours" };

  const log = await deps.store.recentLog(ownerId, new Date(now.getTime() - 36 * 60 * 60_000).toISOString());
  const briefing =
    phase === "morning" || phase === "evening" ? { kind: phase, ...briefingDue(phase, phase, clock.date, log) } : { kind: "morning" as const, due: false, attempt: 0 };
  const nudges = nudgeAllowance({ initiative, phase, today: clock.date, now, log });
  // Nothing could be sent now, so nothing is read: no mail, calendar, or JEV call.
  if (!briefing.due && !nudges.allowed) return { action: "skipped", reason: nudges.reason };

  const today = await deps.buildBriefing(ownerId, timeZone, now);
  const run: Run = { deps, ownerId, now, nowIso: now.toISOString(), today: clock.date, timeZone };
  const candidates = nudgeCandidates(today, now);
  const withIds = await Promise.all(candidates.map(async (candidate) => ({ id: await keyId(ownerId, candidate.key), candidate })));
  const known = await deps.store.loadKeys(ownerId, withIds.map((item) => item.id));
  const stale = withIds.filter((item) => {
    const seenAt = known.get(item.id)?.seenAt;
    return seenAt !== undefined && now.getTime() - Date.parse(seenAt) > KEY_TOUCH_MS;
  });
  // Keeps a thing that is still around from ever being texted a second time,
  // and clears out what has not been seen for 14 days.
  await deps.store
    .touchKeys(ownerId, stale.map((item) => item.id), run.nowIso, new Date(now.getTime() - KEY_TTL_MS).toISOString())
    .catch(() => undefined);
  const fresh = withIds.filter((item) => !known.has(item.id));

  if (briefing.due) return sendBriefing(run, briefing.kind, briefing.attempt, today, fresh);
  return sendNudge(run, fresh);
}

/**
 * The whole check. Accounts are handled one at a time and on their own: one
 * failing never stops the next, and whatever does not fit in the time budget
 * waits for the next check.
 */
export async function runProactiveTick(deps: ProactiveTickDeps): Promise<ProactiveTickSummary> {
  const clock = deps.clock ?? (() => Date.now());
  const now = deps.now ?? new Date();
  const startedAt = clock();
  const summary: ProactiveTickSummary = { checked: 0, sent: 0, failed: 0, skipped: 0, errors: 0, deferred: 0 };
  const accounts = [...new Set(await deps.listAccounts())];
  for (const [index, ownerId] of accounts.entries()) {
    if (index >= (deps.maxAccounts ?? TICK_MAX_ACCOUNTS) || clock() - startedAt > (deps.budgetMs ?? TICK_BUDGET_MS)) {
      summary.deferred += 1;
      continue;
    }
    summary.checked += 1;
    try {
      const outcome = await tickAccount(deps, ownerId, now);
      if (outcome.action === "sent") summary.sent += 1;
      else if (outcome.action === "failed") summary.failed += 1;
      else summary.skipped += 1;
    } catch (error) {
      summary.errors += 1;
      // Never the account id's data, never a phone number: only what went wrong.
      console.error("Proactive text: account check failed", errorCode(error));
    }
  }
  return summary;
}

/**
 * Has the model write a briefing or review. Null on any failure (no key, a
 * timeout, an error, an unusable reply), and the caller writes it itself.
 */
export async function writeBriefingText(
  summary: MorningSummary | EveningSummary,
  language: ResponseLanguage,
  options: { apiKey: string | undefined; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<string | null> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;
  try {
    const response = await (options.fetcher ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 12_000),
      body: JSON.stringify(buildWriterRequest(summary, language)),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OpenAI returned ${response.status}`);
    }
    return readWriterText(await response.json());
  } catch (error) {
    console.error("Proactive text: writing failed", errorCode(error));
    return null;
  }
}
