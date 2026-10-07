"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { CalendarDays, CloudSun, ExternalLink, ListChecks, Loader2, Mail, MessageSquare, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { openMailConnection } from "@/components/mail-connection";
import type { DashboardPanel, DashboardWeather } from "@/lib/dashboard";
import { defaultPanelRefresh, isOwnDataPanel, MAX_DASHBOARD_PANELS, PANEL_REFRESH_CHOICES, panelIsDue, type OwnDataPanelKind } from "@/lib/dashboard";
import type { StageBlock } from "@/lib/stage";
import { momentHeading } from "@/lib/now-context";
import { daysUntil, ownDataKindFor } from "@/lib/panel-tool";
import { pageExcerpt, pageHost, pageWatchBridge, typedPageUrl } from "@/lib/page-watch";
import type { TodayBriefing, TodayCalendar, TodayMoment, TodayTasks } from "@/lib/today";

/** Fired on window after Vox adds or removes a panel in conversation. */
export const PANELS_CHANGED_EVENT = "vox:panels-changed";

const MOMENT_ICON = { email: Mail, event: CalendarDays, task: ListChecks, study: Sparkles } as const;

type WaitingItem = { id: string; title: string; detail: string; action?: { label: string; onClick: () => void } };
type ReminderItem = { id: string; title: string; when: string; soon: boolean; repeat?: string };

/** Plain text from untrusted web or email content. */
function plain(value: string | null | undefined, max = 240) {
  return (value ?? "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function PanelBlock({ block }: { block: StageBlock }) {
  if (block.kind === "facts") {
    return (
      <dl className="dash-facts">
        {block.rows.slice(0, 6).map((row, index) => (
          <div key={index}>
            <dt>{plain(row.label, 60)}</dt>
            <dd>{plain(row.value, 80)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (block.kind === "table") {
    return (
      <table className="dash-table">
        <thead>
          <tr>{block.columns.slice(0, 4).map((column, index) => <th key={index}>{plain(column, 30)}</th>)}</tr>
        </thead>
        <tbody>
          {block.rows.slice(0, 5).map((row, index) => (
            <tr key={index}>{row.slice(0, 4).map((cell, cellIndex) => <td key={cellIndex}>{plain(cell, 40)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (block.kind === "steps" || block.kind === "list") {
    const List = block.kind === "steps" ? "ol" : "ul";
    return <List className="dash-list">{block.items.slice(0, 5).map((item, index) => <li key={index}>{plain(item)}</li>)}</List>;
  }
  if (block.kind === "quote") return <p className="dash-quote">{plain(block.text, 300)}</p>;
  return null;
}

/** What a messages panel shows; the page owns the data and how to re-check it. */
export type LiveMessages = {
  items: Array<{ id: string; from: string; text: string; kind: "text" | "email"; unread: boolean }>;
  /** Checks for new texts, email, events and to-dos now. */
  refresh: () => void;
  /** For calendar and to-do panels; null until Today has loaded. */
  calendar?: TodayCalendar | null;
  tasks?: TodayTasks | null;
  /** Opens Google's consent for calendar and tasks. */
  onAllowGoogle?: () => void;
};

const OWN_DATA_TITLES: Record<OwnDataPanelKind, string> = { messages: "Messages", calendar: "Calendar", tasks: "To do" };

/** "14:30" today, "Thu 14:30" otherwise; "All day" or "Thu" for all-day events. */
function eventWhen(start: string, allDay: boolean) {
  const date = new Date(allDay ? `${start.slice(0, 10)}T00:00:00` : start);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date().toDateString() === date.toDateString();
  const day = date.toLocaleDateString(undefined, { weekday: "short" });
  if (allDay) return today ? "All day" : day;
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return today ? time : `${day} ${time}`;
}

/** Why a calendar or to-do panel has nothing to list, with the way forward. */
function GoogleGap({ part, what, onAllow }: { part: TodayCalendar | TodayTasks | null | undefined; what: string; onAllow?: () => void }) {
  if (!part) return <p className="dash-text">Loading…</p>;
  if (part.connected && !part.needsAccess) {
    return <p className="dash-text">{part.error ? `Couldn’t load your ${what} right now.` : `Nothing on your ${what} for now.`}</p>;
  }
  return (
    <>
      <p className="dash-text">
        {part.connected ? `Vox isn’t allowed to see your ${what} yet.` : `Connect your Google account and Vox can show your ${what}.`}
      </p>
      {onAllow ? (
        <button type="button" className="dash-button" onClick={onAllow}>
          {part.connected ? "Allow access" : "Connect Google"}
        </button>
      ) : null}
    </>
  );
}

function PaceSelect({ panel, onChange }: { panel: DashboardPanel; onChange: (minutes: number) => void }) {
  return (
    <select
      className="dash-select"
      aria-label={`How often ${plain(panel.title, 40)} refreshes`}
      value={panel.refreshMinutes ?? defaultPanelRefresh(panel.kind)}
      onChange={(event) => onChange(Number(event.target.value))}
    >
      {PANEL_REFRESH_CHOICES.map((choice) => (
        <option key={choice.minutes} value={choice.minutes}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function Countdown({ date }: { date: string }) {
  const days = daysUntil(date);
  if (days === null) return null;
  const when = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  return (
    <p className="dash-countdown">
      <strong>{days === 0 ? "Today" : Math.abs(days)}</strong>
      <span>
        {days === 0 ? when : `${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "to go" : "ago"}, ${when}`}
      </span>
    </p>
  );
}

/**
 * Panels the user or Vox made (web look-ups, notes, countdowns, live
 * messages) and the form to add one. Reloads when Vox changes them in
 * conversation.
 */
type PageView = { lines: Array<{ text: string; isNew: boolean }>; moved: boolean; empty: boolean };

export function SavedPanels({ live, onOpenPage }: { live?: LiveMessages; onOpenPage?: (url: string, title: string) => void }) {
  const inputId = useId();
  // Watched pages are read by the Mac app; elsewhere their panels say so.
  const [watch] = useState(() => pageWatchBridge());
  const [pageViews, setPageViews] = useState<Record<string, PageView>>({});
  const pageSeenRef = useRef(new Map<string, { lines: Set<string>; at: number }>());

  const readPage = useCallback(
    async (panel: DashboardPanel) => {
      if (!watch || !panel.url) return;
      const previous = pageSeenRef.current.get(panel.id);
      // Marked as checked up front, so a slow page isn't asked twice.
      pageSeenRef.current.set(panel.id, { lines: previous?.lines ?? new Set(), at: Date.now() });
      const read = await watch.read(panel.url).catch(() => null);
      if (!read) return;
      const excerpt = pageExcerpt(read.text, previous?.lines.size ? previous.lines : null);
      pageSeenRef.current.set(panel.id, { lines: excerpt.all, at: Date.now() });
      setPageViews((current) => ({
        ...current,
        // Lines stay marked new until something newer replaces them.
        [panel.id]: {
          lines: excerpt.newCount || !current[panel.id] ? excerpt.lines : current[panel.id].lines,
          moved: read.moved,
          empty: !read.text.trim(),
        },
      }));
    },
    [watch],
  );
  const readPageRef = useRef(readPage);
  useEffect(() => {
    readPageRef.current = readPage;
  }, [readPage]);
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  const [panels, setPanels] = useState<DashboardPanel[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const loadPanels = useCallback(async () => {
    const response = await fetch("/api/panels", { cache: "no-store" }).catch(() => null);
    if (response?.ok) setPanels(((await response.json()) as { panels?: DashboardPanel[] }).panels ?? []);
    else setPanels((current) => current ?? []);
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadPanels());
    const reload = () => void loadPanels();
    window.addEventListener(PANELS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PANELS_CHANGED_EVENT, reload);
  }, [loadPanels]);

  async function createPanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 3 || busy) return;
    // "My schedule", "to-do list", "messages": the user's own data, which the web can't see.
    const own = ownDataKindFor(text);
    if (own) return addOwnDataPanel(own);
    setBusy("create");
    // A page address, in the Mac app, becomes a watched page; the user signs in on the stage.
    const pageUrl = watch ? typedPageUrl(text) : null;
    try {
      const response = await fetch("/api/panels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pageUrl ? { kind: "page", title: pageHost(pageUrl), url: pageUrl } : { question: text }),
      });
      const payload = (await response.json().catch(() => ({}))) as { panel?: DashboardPanel; error?: string };
      if (!response.ok || !payload.panel) throw new Error(payload.error ?? "Vox couldn’t make that panel.");
      setPanels((current) => [...(current ?? []), payload.panel as DashboardPanel]);
      setQuestion("");
      setCreating(false);
      if (pageUrl) {
        onOpenPage?.(pageUrl, payload.panel.title);
        toast.info("Sign in on the page if it asks", { description: "Vox reads it from your own sign-in on this Mac. It only reads; it never types or sends." });
      }
    } catch (error) {
      toast.error("Couldn’t create the panel", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function addOwnDataPanel(kind: OwnDataPanelKind) {
    if (busy) return;
    setBusy("create");
    try {
      const response = await fetch("/api/panels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: OWN_DATA_TITLES[kind] }),
      });
      const payload = (await response.json().catch(() => ({}))) as { panel?: DashboardPanel; error?: string };
      if (!response.ok || !payload.panel) throw new Error(payload.error ?? "Vox couldn’t make that panel.");
      setPanels((current) => [...(current ?? []), payload.panel as DashboardPanel]);
      setQuestion("");
      setCreating(false);
      liveRef.current?.refresh();
    } catch (error) {
      toast.error("Couldn’t create the panel", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function refreshPanel(id: string) {
    setBusy(id);
    try {
      const response = await fetch("/api/panels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const payload = (await response.json().catch(() => ({}))) as { panel?: DashboardPanel; error?: string };
      if (!response.ok || !payload.panel) throw new Error(payload.error ?? "Vox couldn’t refresh that panel.");
      setPanels((current) => (current ?? []).map((panel) => (panel.id === id ? (payload.panel as DashboardPanel) : panel)));
    } catch (error) {
      toast.error("Couldn’t refresh the panel", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  async function setRefresh(id: string, refreshMinutes: number) {
    setPanels((current) => (current ?? []).map((panel) => (panel.id === id ? { ...panel, refreshMinutes } : panel)));
    const response = await fetch("/api/panels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, refreshMinutes }),
    }).catch(() => null);
    if (!response?.ok) {
      toast.error("Couldn’t save how often that panel refreshes");
      void loadPanels();
    }
  }

  // Web panels refresh themselves at the pace the user chose, one at a time,
  // while Vox is open and visible. A failed attempt waits for the next round.
  const panelsRef = useRef<DashboardPanel[] | null>(null);
  const autoBusyRef = useRef(false);
  useEffect(() => {
    panelsRef.current = panels;
  }, [panels]);
  useEffect(() => {
    const failedAt = new Map<string, number>();
    let liveCheckedAt = Date.now();
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      // Messages panels re-check Vox's own data; one check serves them all.
      // Messages, calendar and to-do panels re-check Vox's own data; one check serves them all.
      const messagePanels = (panelsRef.current ?? []).filter((panel) => isOwnDataPanel(panel.kind));
      if (messagePanels.some((panel) => panelIsDue(panel, Date.now(), liveCheckedAt))) {
        liveCheckedAt = Date.now();
        liveRef.current?.refresh();
      }
      for (const panel of (panelsRef.current ?? []).filter((item) => item.kind === "page")) {
        const seen = pageSeenRef.current.get(panel.id);
        if (!seen || panelIsDue(panel, Date.now(), seen.at)) void readPageRef.current(panel);
      }
      if (autoBusyRef.current) return;
      const due = (panelsRef.current ?? []).find(
        (panel) => panel.kind === "web" && panelIsDue(panel) && Date.now() - (failedAt.get(panel.id) ?? 0) > 10 * 60_000,
      );
      if (!due) return;
      autoBusyRef.current = true;
      try {
        const response = await fetch("/api/panels", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: due.id }),
        });
        const payload = (await response.json().catch(() => ({}))) as { panel?: DashboardPanel };
        if (response.ok && payload.panel) {
          const fresh = payload.panel;
          setPanels((current) => (current ?? []).map((panel) => (panel.id === fresh.id ? fresh : panel)));
        } else failedAt.set(due.id, Date.now());
      } catch {
        failedAt.set(due.id, Date.now());
      } finally {
        autoBusyRef.current = false;
      }
    };
    const timer = window.setInterval(() => void tick(), 10_000);
    const soon = window.setTimeout(() => void tick(), 4_000);
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(soon);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function removePanel(id: string) {
    const removed = (panels ?? []).find((panel) => panel.id === id);
    if (removed?.kind === "page" && removed.url) void watch?.close(removed.url).catch(() => undefined);
    setPanels((current) => (current ?? []).filter((panel) => panel.id !== id));
    const response = await fetch(`/api/panels?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      toast.error("Couldn’t remove the panel");
      void loadPanels();
    }
  }

  const atLimit = (panels?.length ?? 0) >= MAX_DASHBOARD_PANELS;

  return (
    <>
      {(panels ?? []).map((panel) => (
        <section key={panel.id} className="dash-panel" aria-label={plain(panel.title, 80)}>
          <div className="dash-panel-head">
            <h2 className="dash-kicker">{plain(panel.title, 60)}</h2>
            {panel.kind === "web" ? (
              <button type="button" className="dash-icon" aria-label={`Refresh ${plain(panel.title, 40)}`} disabled={busy !== null} onClick={() => void refreshPanel(panel.id)}>
                {busy === panel.id ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
              </button>
            ) : null}
            <button type="button" className="dash-icon" aria-label={`Remove ${plain(panel.title, 40)}`} onClick={() => void removePanel(panel.id)}>
              <X aria-hidden="true" />
            </button>
          </div>
          {panel.kind === "countdown" && panel.date ? <Countdown date={panel.date} /> : null}
          {panel.blocks.slice(0, 2).map((block, index) => <PanelBlock key={index} block={block} />)}
          {panel.kind === "web" ? (
            <div className="dash-foot">
              <p className="dash-note">
                {panel.sources[0] ? `${plain(panel.sources[0].site, 40)}, ` : ""}
                {new Date(panel.refreshedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </p>
              <PaceSelect panel={panel} onChange={(minutes) => void setRefresh(panel.id, minutes)} />
            </div>
          ) : null}
          {panel.kind === "page" ? (
            <>
              {!watch ? (
                <p className="dash-text">Vox watches this page from the Mac app. Open Vox on your Mac to see it.</p>
              ) : pageViews[panel.id]?.moved ? (
                <p className="dash-text">This page is asking you to sign in. Open it and sign in; Vox picks it up from there.</p>
              ) : pageViews[panel.id]?.lines.length ? (
                <ul className="dash-lines">
                  {pageViews[panel.id].lines.map((line, index) => (
                    <li key={index} data-new={line.isNew || undefined}>
                      {plain(line.text, 160)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-text">{pageViews[panel.id]?.empty ? "Nothing readable on the page right now." : "Reading the page…"}</p>
              )}
              <div className="dash-foot">
                {panel.url && onOpenPage ? (
                  <button type="button" className="dash-link" onClick={() => onOpenPage(panel.url as string, panel.title)}>
                    <ExternalLink aria-hidden="true" /> {plain(pageHost(panel.url), 30)}
                  </button>
                ) : (
                  <p className="dash-note">{plain(pageHost(panel.url ?? ""), 30)}</p>
                )}
                <PaceSelect panel={panel} onChange={(minutes) => void setRefresh(panel.id, minutes)} />
              </div>
            </>
          ) : null}
          {panel.kind === "calendar" ? (
            <>
              {live?.calendar?.connected && !live.calendar.needsAccess && live.calendar.events.length ? (
                <ul className="dash-rows">
                  {live.calendar.events.slice(0, 5).map((event) => (
                    <li key={event.id}>
                      <div>
                        <strong>{plain(event.title, 80) || "(no title)"}</strong>
                        <span>
                          {eventWhen(event.start, event.allDay)}
                          {event.location ? `, ${plain(event.location, 40)}` : ""}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <GoogleGap part={live?.calendar} what="calendar" onAllow={live?.onAllowGoogle} />
              )}
              <div className="dash-foot">
                <p className="dash-note">Next day and a half</p>
                <PaceSelect panel={panel} onChange={(minutes) => void setRefresh(panel.id, minutes)} />
              </div>
            </>
          ) : null}
          {panel.kind === "tasks" ? (
            <>
              {live?.tasks?.connected && !live.tasks.needsAccess && live.tasks.items.length ? (
                <ul className="dash-rows">
                  {live.tasks.items.slice(0, 5).map((task) => (
                    <li key={task.id}>
                      <div>
                        <strong>{plain(task.title, 80)}</strong>
                        <span>{task.overdue ? "Overdue" : task.due ? `Due ${new Date(`${task.due.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}` : ""}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <GoogleGap part={live?.tasks} what="to-do list" onAllow={live?.onAllowGoogle} />
              )}
              <div className="dash-foot">
                <p className="dash-note">Due this week</p>
                <PaceSelect panel={panel} onChange={(minutes) => void setRefresh(panel.id, minutes)} />
              </div>
            </>
          ) : null}
          {panel.kind === "messages" ? (
            <>
              {live?.items.length ? (
                <ul className="dash-rows">
                  {live.items.slice(0, 5).map((item) => (
                    <li key={item.id} className="dash-moment" data-unread={item.unread || undefined}>
                      {item.kind === "email" ? <Mail aria-hidden="true" /> : <MessageSquare aria-hidden="true" />}
                      <div>
                        <strong>{plain(item.from, 60) || "Unknown sender"}</strong>
                        <span>{plain(item.text, 140)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dash-text">No new texts, and no email that needs you.</p>
              )}
              <div className="dash-foot">
                <p className="dash-note">Texts and email</p>
                <PaceSelect panel={panel} onChange={(minutes) => void setRefresh(panel.id, minutes)} />
              </div>
            </>
          ) : null}
        </section>
      ))}

      {creating ? (
        <form className="dash-panel" onSubmit={createPanel}>
          <label htmlFor={inputId} className="dash-kicker">What should Vox keep an eye on?</label>
          <input
            id={inputId}
            className="dash-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={watch ? "USD to TWD rate, exam dates, or a page address…" : "USD to TWD rate, typhoon news, exam dates…"}
            maxLength={200}
            autoFocus
          />
          <div className="dash-actions">
            <button type="submit" className="dash-button" disabled={busy !== null || question.trim().length < 3}>
              {busy === "create" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {busy === "create" ? "Looking it up…" : "Create panel"}
            </button>
            <button type="button" className="dash-button is-quiet" onClick={() => setCreating(false)} disabled={busy === "create"}>
              Cancel
            </button>
          </div>
          <div className="dash-actions" aria-label="Panels from your own accounts">
            {(["calendar", "tasks", "messages"] as const)
              .filter((kind) => !(panels ?? []).some((panel) => panel.kind === kind))
              .map((kind) => (
                <button key={kind} type="button" className="dash-button is-quiet" onClick={() => void addOwnDataPanel(kind)} disabled={busy !== null}>
                  {OWN_DATA_TITLES[kind]}
                </button>
              ))}
          </div>
          <p className="dash-note">
            {watch
              ? "Type a page address (like instagram.com/direct/inbox) to watch a page you’re signed in to. You can also ask Vox for a note, a list, or a countdown."
              : "You can also ask Vox for a note, a list, or a countdown to a date."}
          </p>
        </form>
      ) : (
        <button type="button" className="dash-create" onClick={() => setCreating(true)} disabled={atLimit}>
          <Plus aria-hidden="true" /> {atLimit ? "Remove a panel to add another" : "Create a new panel"}
        </button>
      )}
    </>
  );
}

/** One thing Today picked as worth attention now. */
export function MomentRow({ moment, onStudy }: { moment: TodayMoment; onStudy?: () => void }) {
  const Icon = MOMENT_ICON[moment.kind];
  return (
    <li className="dash-moment">
      <Icon aria-hidden="true" />
      <div>
        <strong>{plain(moment.title, 80)}</strong>
        <span>{plain(moment.why, 80)}</span>
      </div>
      {moment.kind === "study" && onStudy ? (
        <button type="button" className="dash-link" onClick={onStudy}>
          Study
        </button>
      ) : null}
    </li>
  );
}

/**
 * The dashboard beside the conversation (Daylight theme): the weather, the few
 * things that matter at this moment, and panels the user or Vox made. The
 * full lists live in Today.
 */
export function DashboardPanels({
  briefing,
  waiting,
  reminders,
  onStudy,
  onOpenToday,
  onBrief,
  live,
  onOpenPage,
}: {
  briefing: TodayBriefing | null;
  waiting: WaitingItem[];
  reminders: ReminderItem[];
  onStudy: () => void;
  onOpenToday: () => void;
  /** Asks Vox to talk through what matters now; absent when Vox isn't listening. */
  onBrief?: () => void;
  /** Feeds messages panels. */
  live?: LiveMessages;
  /** Shows a watched page on the stage (Mac app). */
  onOpenPage?: (url: string, title: string) => void;
}) {
  const [weather, setWeather] = useState<DashboardWeather | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadWeather = () =>
      fetch("/api/weather", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<DashboardWeather>) : null))
        .then((next) => {
          if (!cancelled && next) setWeather(next);
        })
        .catch(() => undefined);
    void loadWeather();
    const timer = window.setInterval(() => void loadWeather(), 15 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const soon = reminders.filter((reminder) => reminder.soon);
  const mail = briefing?.mail;
  // An event with something to settle is listed once, not again as a moment.
  const prep = (briefing?.prep ?? []).slice(0, 3);
  const moments = (briefing?.now ?? []).filter((moment) => !(moment.kind === "event" && prep.some((item) => item.eventId === moment.id)));
  const heading = momentHeading(new Date().getHours());

  return (
    <aside className="dash" aria-label="Dashboard">
      {mail && !mail.connected && (
        <section className="dash-panel" aria-labelledby="dash-more">
          <h2 id="dash-more" className="dash-serif">Vox can do more</h2>
          <p className="dash-text">Connect your email and Vox will point out what’s worth reading, draft replies, and tidy up.</p>
          <div className="dash-actions">
            <button type="button" className="dash-button" onClick={() => void openMailConnection({ provider: "google" })}>
              <Mail aria-hidden="true" /> Connect Gmail
            </button>
            <button type="button" className="dash-button is-quiet" onClick={() => void openMailConnection()}>
              Other email
            </button>
          </div>
        </section>
      )}

      {weather?.available && (
        <section className="dash-panel" aria-label="Weather">
          <p className="dash-kicker">
            <CloudSun aria-hidden="true" /> {plain(weather.place, 60) || "Near you"}
          </p>
          <div className="dash-tiles">
            <div>
              <span>{plain(weather.condition, 24)}</span>
              <strong>{Math.round(weather.temperatureC)}°C</strong>
            </div>
            <div>
              <span>Feels like</span>
              <strong>{Math.round(weather.feelsLikeC)}°</strong>
            </div>
            <div>
              <span>{weather.isDay ? "Sunset" : "Sunrise"}</span>
              <strong>{(weather.isDay ? weather.sunset : weather.sunrise) ?? "–"}</strong>
            </div>
          </div>
          <p className="dash-note">Based on approximate location.</p>
        </section>
      )}

      {(waiting.length > 0 || soon.length > 0 || moments.length > 0 || prep.length > 0) && (
        <section className="dash-panel" aria-labelledby="dash-now">
          <h2 id="dash-now" className={`dash-kicker${waiting.length > 0 ? " is-amber" : ""}`}>
            {waiting.length > 0 ? "Waiting on you" : heading}
          </h2>
          <ul className="dash-rows">
            {waiting.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{plain(item.title, 80)}</strong>
                  <span>{plain(item.detail, 120)}</span>
                </div>
                {item.action ? (
                  <button type="button" className="dash-link" onClick={item.action.onClick}>
                    {item.action.label}
                  </button>
                ) : null}
              </li>
            ))}
            {soon.map((reminder) => (
              <li key={reminder.id}>
                <div>
                  <strong>{plain(reminder.title, 80)}</strong>
                  <span>{reminder.repeat ? `${reminder.when} · ${plain(reminder.repeat, 60)}` : reminder.when}</span>
                </div>
              </li>
            ))}
            {prep.map((item) => (
              <li key={item.id} className="dash-moment">
                <CalendarDays aria-hidden="true" />
                <div>
                  <strong>{plain(item.title, 80)}</strong>
                  <span>{plain(item.why, 100)}</span>
                </div>
              </li>
            ))}
            {moments.map((moment) => (
              <MomentRow key={`${moment.kind}-${moment.id}`} moment={moment} onStudy={onStudy} />
            ))}
          </ul>
          <div className="dash-actions">
            {onBrief ? (
              <button type="button" className="dash-button" onClick={onBrief}>
                Brief me
              </button>
            ) : null}
            <button type="button" className="dash-button is-quiet" onClick={onOpenToday}>
              Everything else
            </button>
          </div>
        </section>
      )}

      <SavedPanels live={live} onOpenPage={onOpenPage} />
    </aside>
  );
}
