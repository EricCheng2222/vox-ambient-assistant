"use client";

import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { ChevronRight, CircleAlert, FileText, Link2, RefreshCw } from "lucide-react";

import { categoryCounts, MAIL_CATEGORY_LABELS } from "@/lib/mail-category";
import { momentHeading } from "@/lib/now-context";
import type { TodayBriefing } from "@/lib/today";

export type TodayWaitingItem = {
  id: string;
  title: string;
  detail: string;
  tone: "amber" | "cyan";
  action?: { label: string; onClick: () => void };
};
/** `repeat` is how a repeating reminder repeats ("Every weekday, 08:00"); `when` is its next time. */
export type TodayReminderItem = { id: string; title: string; when: string; soon: boolean; repeat?: string };
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
  /** Opens Google's consent so Vox can also use the calendar, tasks, contacts and Drive. */
  onAllowGoogle: () => void;
  onOpenReminders?: () => void;
  onOpenFiles?: () => void;
  /** Asks Vox to talk through what matters now; absent when Vox isn't listening. */
  onBrief?: () => void;
  /** Panels the user or Vox made, shown after the day's sections. */
  panels?: ReactNode;
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

const MOMENT_LABEL = { email: "Email", event: "Next", task: "To do", study: "Study" } as const;

/** "14:30" today, "Thu 14:30" otherwise; "All day" or "Thu" for all-day events. */
function eventTime(start: string, allDay: boolean, todayKey: string) {
  const date = new Date(allDay ? `${start.slice(0, 10)}T00:00:00` : start);
  if (Number.isNaN(date.getTime())) return "";
  const isToday = Boolean(todayKey) && dayKey(date) === todayKey;
  if (allDay) return isToday ? "All day" : fmt.weekdayShort.format(date);
  return isToday ? fmt.time.format(date) : `${fmt.weekdayShort.format(date)} ${fmt.time.format(date)}`;
}

/** "Today", "Thu", or "9 Oct" for a task's due date. */
function taskDue(due: string | null, todayKey: string) {
  if (!due) return "";
  const date = new Date(`${due.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (todayKey && dayKey(date) === todayKey) return "Today";
  const today = dateFromKey(todayKey);
  const days = today ? (date.getTime() - today.getTime()) / 86_400_000 : 99;
  return days > 0 && days < 7 ? fmt.weekdayShort.format(date) : `${date.getDate()} ${fmt.monthShort.format(date)}`;
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
  onAllowGoogle,
  onOpenReminders,
  onOpenFiles,
  onBrief,
  panels,
}: TodayPanelProps) {
  const baseId = useId();
  const todayKey = useToday();
  const today = dateFromKey(todayKey);
  const compact = variant === "compact";
  const Title = compact ? "h2" : "h1";
  const Sub = compact ? "h3" : "h2";
  const ids = {
    title: `${baseId}-title`,
    now: `${baseId}-now`,
    calendar: `${baseId}-calendar`,
    tasks: `${baseId}-tasks`,
    panels: `${baseId}-panels`,
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
  // Grouped by kind, so the promotions sit together below the rest.
  const otherMailCounts = categoryCounts((mailConnected ? (mail?.other ?? []) : []).map((message) => message.category));
  const otherMailOrder = [...otherMailCounts].reverse().map(([category]) => category);
  const otherMail = (mailConnected ? [...(mail?.other ?? [])] : []).sort(
    (a, b) => otherMailOrder.indexOf(a.category as never) - otherMailOrder.indexOf(b.category as never),
  );
  const otherMailMix = otherMailCounts
    .slice(0, 3)
    .map(([category, count]) => `${count} ${MAIL_CATEGORY_LABELS[category].toLowerCase()}`)
    .join(", ");
  const [showOtherMail, setShowOtherMail] = useState(false);
  const showConnectMail = Boolean(briefing && mail && !mail.connected);

  const moments = briefing?.now ?? [];
  const calendar = briefing?.calendar;
  const events = calendar?.connected ? calendar.events.slice(0, compact ? 4 : 8) : [];
  const tasks = briefing?.tasks;
  const openTasks = tasks?.connected ? tasks.items.slice(0, compact ? 4 : 8) : [];
  // Mail is connected but the Google account predates calendar and task access.
  const needsGoogleAccess = mailConnected && Boolean(calendar?.needsAccess || tasks?.needsAccess);

  const laterLimit = compact ? 5 : 10;
  const fileLimit = compact ? 4 : 8;

  const hasContent =
    waitingCount > 0 ||
    moments.length > 0 ||
    events.length > 0 ||
    openTasks.length > 0 ||
    decks.length > 0 ||
    unread.length > 0 ||
    otherMail.length > 0 ||
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
                    <div className="vx-card-detail">{plain(reminder.repeat, 60) || "Reminder"}</div>
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

        {moments.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.now}>
            <SectionHead
              as={Sub}
              id={ids.now}
              label={momentHeading(new Date().getHours())}
              action={onBrief ? { label: "Brief me", ariaLabel: "Ask Vox to brief you", onClick: onBrief } : undefined}
            />
            {moments.map((moment) => (
              <div key={`${moment.kind}-${moment.id}`} className="vx-card" data-tone="cyan">
                <div className="vx-card-when">{MOMENT_LABEL[moment.kind]}</div>
                <div className="vx-card-body">
                  <div className="vx-card-title">{plain(moment.title)}</div>
                  <div className="vx-card-detail">{plain(moment.why, 120)}</div>
                </div>
                {moment.kind === "study" ? (
                  <button type="button" className="vx-btn vx-card-action" onClick={onStudy}>
                    Study
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {briefingPending ? <SkeletonSection /> : null}

        {events.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.calendar}>
            <SectionHead as={Sub} id={ids.calendar} label="Calendar" />
            <ul className="vx-plain-list">
              {events.map((event) => (
                <li key={event.id}>
                  <div className="vx-row">
                    <span className="vx-row-when">{eventTime(event.start, event.allDay, todayKey)}</span>
                    <span className="vx-row-main">{plain(event.title) || "(no title)"}</span>
                    {event.location ? <span className="vx-row-meta">{plain(event.location, 40)}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {openTasks.length > 0 ? (
          <section className="vx-section" aria-labelledby={ids.tasks}>
            <SectionHead as={Sub} id={ids.tasks} label="To do" />
            <ul className="vx-plain-list">
              {openTasks.map((task) => (
                <li key={task.id}>
                  <div className="vx-row" data-tone={task.overdue ? "amber" : undefined}>
                    <span className="vx-row-when">{task.overdue ? "Overdue" : taskDue(task.due, todayKey)}</span>
                    <span className="vx-row-main">{plain(task.title)}</span>
                    <span className="vx-row-meta">{plain(task.list, 30)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {needsGoogleAccess ? (
          <p className="vx-quiet-line">
            <span>Let Vox see your calendar, tasks, contacts and files too.</span>
            <button type="button" className="vx-btn" onClick={onAllowGoogle}>
              <Link2 aria-hidden="true" /> Allow access
            </button>
          </p>
        ) : null}

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

        {unread.length > 0 || otherMail.length > 0 || mailError ? (
          <section className="vx-section" aria-labelledby={ids.mail}>
            <SectionHead
              as={Sub}
              id={ids.mail}
              label={unread.length > 0 || otherMail.length === 0 ? "Email worth reading" : "Email"}
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
                  const account = [message.category ? MAIL_CATEGORY_LABELS[message.category] : "", plain(message.account, 60)].filter(Boolean).join("  ·  ");
                  return (
                    <li key={message.id} className="vx-mail-item">
                      <span className="vx-dot" data-tone={message.importance === "needs_you" ? "amber" : undefined} aria-hidden="true" />
                      <div className="vx-card-body">
                        <span className="vx-mail-from">
                          {plain(message.from, 120) || "Unknown sender"}
                          {message.importance === "needs_you" ? <span className="vx-mail-flag">Needs you</span> : null}
                        </span>
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
            {unread.length === 0 && otherMail.length > 0 ? (
              <p className="vx-card-detail">Nothing unread needs you. Vox set aside promotions, newsletters and notices.</p>
            ) : null}
            {otherMail.length > 0 ? (
              <>
                <button
                  type="button"
                  className="vx-link"
                  aria-expanded={showOtherMail}
                  onClick={() => setShowOtherMail((current) => !current)}
                >
                  {showOtherMail ? "Hide other unread" : `Show ${otherMail.length} other unread${otherMailMix ? ` (${otherMailMix})` : ""}`}
                </button>
                {showOtherMail ? (
                  <ul className="vx-mail-list">
                    {otherMail.map((message) => {
                      const when = mailTime(message.date, todayKey);
                      return (
                        <li key={message.id} className="vx-mail-item">
                          <span className="vx-dot" data-tone="off" aria-hidden="true" />
                          <div className="vx-card-body">
                            <span className="vx-mail-from">{plain(message.from, 120) || "Unknown sender"}</span>
                            <span className="vx-mail-subject">{plain(message.subject, 200) || "(no subject)"}</span>
                            {when || message.category ? (
                              <span className="vx-mail-meta">
                                {[message.category ? MAIL_CATEGORY_LABELS[message.category] : "", when].filter(Boolean).join("  ·  ")}
                              </span>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {showOtherMail ? (
                  <p className="vx-card-detail">To read one, ask Vox: “read the email from …”.</p>
                ) : null}
              </>
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
                    {reminder.repeat ? <span className="vx-row-meta">{plain(reminder.repeat, 32)}</span> : null}
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

        {panels ? (
          <section className="vx-section saved-panels" aria-labelledby={ids.panels}>
            <SectionHead as={Sub} id={ids.panels} label="Your panels" />
            {panels}
          </section>
        ) : null}
      </div>
    </section>
  );
}
