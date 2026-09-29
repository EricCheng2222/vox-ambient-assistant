"use client";

import { useId, useSyncExternalStore } from "react";
import { ChevronRight, CircleAlert, FileText, Link2, RefreshCw } from "lucide-react";

import type { TodayBriefing } from "@/lib/today";

export type TodayWaitingItem = {
  id: string;
  title: string;
  detail: string;
  tone: "amber" | "cyan";
  action?: { label: string; onClick: () => void };
};
export type TodayReminderItem = { id: string; title: string; when: string; soon: boolean };
export type TodayMacTask = {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  detail?: string;
};
export type TodayFileItem = { id: string; name: string; when: string };

export type TodayPanelProps = {
  /** "compact": the narrow column beside the conversation. "full": the Today page. */
  variant: "full" | "compact";
  briefing: TodayBriefing | null;
  loading: boolean;
  onRefresh?: () => void;
  /** Approvals (e.g. an email waiting for "yes"), shown first under "Waiting on you". */
  waiting: TodayWaitingItem[];
  /** `soon` reminders (due within 2 hours) go under "Waiting on you", the rest under "Coming up". */
  reminders: TodayReminderItem[];
  macTasks: TodayMacTask[];
  files: TodayFileItem[];
  onStudy: () => void;
  onOpenEmail: () => void;
  onOpenReminders?: () => void;
  onOpenFiles?: () => void;
};

// --- Text and dates ---------------------------------------------------------

/** Plain, single-line text from an untrusted string: no control or bidi-override characters. */
function plain(text: string | null | undefined, max = 240): string {
  if (!text) return "";
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) out += " ";
    else if (code < 32 || code === 127 || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)) continue;
    else out += char;
  }
  out = out.replace(/\s+/g, " ").trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
function subscribeToClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}
/** Today's local date as a stable key, "" while rendering on the server. */
function useToday() {
  return useSyncExternalStore(subscribeToClock, () => dayKey(new Date()), () => "");
}
function dateFromKey(key: string) {
  if (!key) return null;
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const fmt = {
  weekdayShort: new Intl.DateTimeFormat("en-US", { weekday: "short" }),
  weekdayLong: new Intl.DateTimeFormat("en-US", { weekday: "long" }),
  monthShort: new Intl.DateTimeFormat("en-US", { month: "short" }),
  monthLong: new Intl.DateTimeFormat("en-US", { month: "long" }),
  time: new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
};

function hudDate(date: Date) {
  return `${fmt.weekdayShort.format(date)} ${date.getDate()} ${fmt.monthShort.format(date)}`;
}
function plainDate(date: Date) {
  return `${fmt.weekdayLong.format(date)}, ${date.getDate()} ${fmt.monthLong.format(date)}`;
}

/** "09:12" today, "Mon" this week, "28 Sep" otherwise. */
function mailTime(value: string | null, todayKey: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (todayKey && dayKey(date) === todayKey) return fmt.time.format(date);
  const today = dateFromKey(todayKey);
  if (today) {
    const days = (today.getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000;
    if (days > 0 && days < 6) return fmt.weekdayShort.format(date);
  }
  return `${date.getDate()} ${fmt.monthShort.format(date)}`;
}

function pad(count: number) {
  return String(count).padStart(2, "0");
}

// --- Pieces -----------------------------------------------------------------

function SectionHead({
  as: Tag,
  id,
  label,
  meta,
  tone,
  action,
}: {
  as: "h2" | "h3";
  id: string;
  label: string;
  meta?: string;
  tone?: "amber";
  action?: { label: string; ariaLabel: string; onClick: () => void };
}) {
  return (
    <Tag id={id} className="vx-hud vx-section-head" data-tone={tone}>
      <span>{label}</span>
      {action ? (
        <button type="button" className="vx-link" aria-label={action.ariaLabel} onClick={action.onClick}>
          {action.label}
        </button>
      ) : meta ? (
        <span>{meta}</span>
      ) : null}
    </Tag>
  );
}

function SkeletonSection() {
  return (
    <div className="vx-section" aria-hidden="true">
      <div className="vx-skeleton" style={{ width: "38%", height: "0.7rem" }} />
      <div className="vx-skeleton" style={{ height: "3.9rem", borderRadius: "0.75rem" }} />
      <div className="vx-skeleton" style={{ width: "82%", height: "0.8rem" }} />
    </div>
  );
}

// --- Panel ------------------------------------------------------------------

/**
 * The Today briefing: what's waiting on the user, flash cards due, email worth
 * reading, Mac tasks, upcoming reminders, and recent files. Presentational;
 * the page owns the data. Email text is untrusted and rendered as plain text.
 */
export function TodayPanel({
  variant,
  briefing,
  loading,
  onRefresh,
  waiting,
  reminders,
  macTasks,
  files,
  onStudy,
  onOpenEmail,
  onOpenReminders,
  onOpenFiles,
}: TodayPanelProps) {
  const baseId = useId();
  const todayKey = useToday();
  const today = dateFromKey(todayKey);
  const compact = variant === "compact";
  const Title = compact ? "h2" : "h1";
  const Sub = compact ? "h3" : "h2";
  const ids = {
    title: `${baseId}-title`,
    waiting: `${baseId}-waiting`,
    study: `${baseId}-study`,
    mail: `${baseId}-mail`,
    mac: `${baseId}-mac`,
    coming: `${baseId}-coming`,
    files: `${baseId}-files`,
  };

  const soon = reminders.filter((reminder) => reminder.soon);
  const later = reminders.filter((reminder) => !reminder.soon);
  const waitingCount = waiting.length + soon.length;

  const briefingPending = loading && !briefing;
  const cards = briefing?.flashcards;
  const decks = cards?.connected ? cards.decks.filter((deck) => deck.due > 0) : [];
  const totalDue = cards?.totalDue ?? decks.reduce((sum, deck) => sum + deck.due, 0);

  const mail = briefing?.mail;
  const mailConnected = Boolean(mail?.connected);
  const unread = mailConnected ? (mail?.unread ?? []).slice(0, 3) : [];
  const mailError = mailConnected ? plain(mail?.error, 160) : "";
  const showConnectMail = Boolean(briefing && mail && !mail.connected);

  const laterLimit = compact ? 5 : 10;
  const fileLimit = compact ? 4 : 8;

  const hasContent =
    waitingCount > 0 ||
    decks.length > 0 ||
    unread.length > 0 ||
    Boolean(mailError) ||
    macTasks.length > 0 ||
    later.length > 0 ||
    files.length > 0;

  const connectMail = (
    <p className="vx-quiet-line">
      <span>Connect your email and Vox will point out what’s worth reading.</span>
      <button type="button" className="vx-btn" onClick={onOpenEmail}>
        <Link2 aria-hidden="true" /> Connect email
      </button>
    </p>
  );

  return (
    <section
      className="vx-today"
      data-variant={variant}
      aria-labelledby={ids.title}
      aria-busy={loading || undefined}
    >
      <span className="vx-today-bracket" aria-hidden="true" />
      <header className="vx-today-head">
        <div>
          <p className="vx-hud vx-today-date-hud">
            {today ? `Situation / ${hudDate(today)}` : "Situation"}
          </p>
          <Title id={ids.title} className="vx-today-title">
            Today
          </Title>
          {today ? <p className="vx-today-date vx-today-date-plain">{plainDate(today)}</p> : null}
        </div>
        {onRefresh ? (
          <button
            type="button"
            className="vx-icon-btn vx-today-refresh"
            data-busy={loading || undefined}
            aria-label={loading ? "Refreshing Today" : "Refresh Today"}
            onClick={onRefresh}
          >
            <RefreshCw aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {briefingPending ? (
        <p className="sr-only" role="status">
          Loading your day…
        </p>
      ) : null}

      <div className="vx-today-sections">
        {!hasContent && !briefingPending ? (
          <div className="vx-empty">
            <p>Nothing needs you right now. Ask Vox anything, or enjoy the quiet.</p>
            {showConnectMail ? connectMail : null}
          </div>
        ) : null}

        {waitingCount > 0 ? (
          <section className="vx-section" aria-labelledby={ids.waiting}>
            <SectionHead as={Sub} id={ids.waiting} label="Waiting on you" meta={pad(waitingCount)} tone="amber" />
            {waiting.map((item) => (
              <div key={item.id} className="vx-card" data-tone={item.tone}>
                <div className="vx-card-when">Now</div>
                <div className="vx-card-body">
                  <div className="vx-card-title">{plain(item.title)}</div>
                  {item.detail ? <div className="vx-card-detail">{plain(item.detail, 400)}</div> : null}
                </div>
                {item.action ? (
                  <button
                    type="button"
                    className="vx-btn vx-card-action"
                    data-tone={item.tone}
                    onClick={item.action.onClick}
                  >
                    {item.action.label}
                  </button>
                ) : null}
              </div>
            ))}
            {soon.map((reminder) => {
              const content = (
                <>
                  <div className="vx-card-when">{plain(reminder.when, 24)}</div>
                  <div className="vx-card-body">
                    <div className="vx-card-title">{plain(reminder.title)}</div>
                    <div className="vx-card-detail">Reminder</div>
                  </div>
                </>
              );
              return onOpenReminders ? (
                <button key={reminder.id} type="button" className="vx-card" onClick={onOpenReminders}>
                  {content}
                </button>
              ) : (
                <div key={reminder.id} className="vx-card">
                  {content}
                </div>
              );
            })}
          </section>
        ) : null}

        {briefingPending ? <SkeletonSection /> : null}

        {decks.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.study}>
            <SectionHead as={Sub} id={ids.study} label="Study" meta={totalDue ? `${totalDue} due` : undefined} />
            <div className="vx-card vx-study">
              <ul className="vx-deck-list">
                {decks.slice(0, 4).map((deck) => (
                  <li key={deck.id} className="vx-card-body">
                    <span className="vx-card-title">{plain(deck.title)}</span>
                    <span className="vx-card-detail">
                      {deck.due} {deck.due === 1 ? "card" : "cards"} due
                    </span>
                  </li>
                ))}
                {decks.length > 4 ? (
                  <li className="vx-card-detail">
                    and {decks.length - 4} more {decks.length - 4 === 1 ? "deck" : "decks"}
                  </li>
                ) : null}
              </ul>
              <button type="button" className="vx-btn vx-btn-accent" onClick={onStudy}>
                Study with Vox
              </button>
            </div>
          </section>
        ) : null}

        {briefingPending ? <SkeletonSection /> : null}

        {unread.length > 0 || mailError ? (
          <section className="vx-section" aria-labelledby={ids.mail}>
            <SectionHead
              as={Sub}
              id={ids.mail}
              label="Email worth reading"
              meta={
                mail && mail.accounts.length > 1
                  ? `${mail.accounts.length} accounts`
                  : mail?.unreadCount
                    ? `${mail.unreadCount} unread`
                    : undefined
              }
            />
            {unread.length > 0 ? (
              <ul className="vx-mail-list">
                {unread.map((message) => {
                  const when = mailTime(message.date, todayKey);
                  const account = plain(message.account, 60);
                  return (
                    <li key={message.id} className="vx-mail-item">
                      <span className="vx-dot" aria-hidden="true" />
                      <div className="vx-card-body">
                        <span className="vx-mail-from">{plain(message.from, 120) || "Unknown sender"}</span>
                        <span className="vx-mail-subject">{plain(message.subject, 200) || "(no subject)"}</span>
                        {account || when ? (
                          <span className="vx-mail-meta">
                            {account}
                            {account && when ? "  ·  " : ""}
                            {when}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {mailError ? (
              <p className="vx-error-line">
                <CircleAlert aria-hidden="true" />
                <span>Couldn’t check your email: {mailError}</span>
                <button type="button" className="vx-btn vx-btn-quiet" onClick={onOpenEmail}>
                  Check connection
                </button>
              </p>
            ) : null}
          </section>
        ) : null}

        {showConnectMail && hasContent ? (
          <section className="vx-section" aria-labelledby={ids.mail}>
            <SectionHead as={Sub} id={ids.mail} label="Email" />
            {connectMail}
          </section>
        ) : null}

        {macTasks.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.mac}>
            <SectionHead as={Sub} id={ids.mac} label="On your Mac" />
            {macTasks.map((task) => (
              <div key={task.id} className="vx-card vx-task" data-status={task.status}>
                <div className="vx-task-top">
                  <span className="vx-card-title">{plain(task.title)}</span>
                  <span className="vx-task-status">
                    {task.status === "running" ? "Running" : task.status === "done" ? "Done" : "Failed"}
                  </span>
                </div>
                {task.detail ? <div className="vx-card-detail">{plain(task.detail, 400)}</div> : null}
                {task.status === "running" ? (
                  <div className="vx-progress" role="progressbar" aria-label={`${plain(task.title)}, in progress`}>
                    <span />
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {later.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.coming}>
            <SectionHead
              as={Sub}
              id={ids.coming}
              label="Coming up"
              meta={later.length > laterLimit ? `${later.length}` : undefined}
              action={
                onOpenReminders
                  ? { label: "All", ariaLabel: "All reminders", onClick: onOpenReminders }
                  : undefined
              }
            />
            <ul className="vx-plain-list">
              {later.slice(0, laterLimit).map((reminder) => {
                const content = (
                  <>
                    <span className="vx-row-when">{plain(reminder.when, 24)}</span>
                    <span className="vx-row-main">{plain(reminder.title)}</span>
                  </>
                );
                return (
                  <li key={reminder.id}>
                    {onOpenReminders ? (
                      <button type="button" className="vx-row" onClick={onOpenReminders}>
                        {content}
                      </button>
                    ) : (
                      <div className="vx-row">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {files.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.files}>
            <SectionHead
              as={Sub}
              id={ids.files}
              label="Recent files"
              action={onOpenFiles ? { label: "All", ariaLabel: "All files", onClick: onOpenFiles } : undefined}
            />
            <ul className="vx-plain-list">
              {files.slice(0, fileLimit).map((file) => {
                const content = (
                  <>
                    <FileText aria-hidden="true" />
                    <span className="vx-row-main">{plain(file.name)}</span>
                    <span className="vx-row-meta">{plain(file.when, 24)}</span>
                    {onOpenFiles ? <ChevronRight aria-hidden="true" /> : null}
                  </>
                );
                return (
                  <li key={file.id}>
                    {onOpenFiles ? (
                      <button type="button" className="vx-row" onClick={onOpenFiles}>
                        {content}
                      </button>
                    ) : (
                      <div className="vx-row">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </section>
  );
}
