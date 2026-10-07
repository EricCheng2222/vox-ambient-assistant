"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { CloudSun, Loader2, Mail, Plus, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { openMailConnection } from "@/components/mail-connection";
import type { DashboardPanel, DashboardWeather } from "@/lib/dashboard";
import { MAX_DASHBOARD_PANELS } from "@/lib/dashboard";
import type { StageBlock } from "@/lib/stage";
import type { TodayBriefing } from "@/lib/today";

type WaitingItem = { id: string; title: string; detail: string; action?: { label: string; onClick: () => void } };
type ReminderItem = { id: string; title: string; when: string; soon: boolean };

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

/**
 * The dashboard beside the conversation (Daylight theme): small panels for
 * what matters now, plus panels the user asked Vox to make and keep.
 */
export function DashboardPanels({
  briefing,
  waiting,
  reminders,
  onStudy,
  onOpenToday,
}: {
  briefing: TodayBriefing | null;
  waiting: WaitingItem[];
  reminders: ReminderItem[];
  onStudy: () => void;
  onOpenToday: () => void;
}) {
  const [weather, setWeather] = useState<DashboardWeather | null>(null);
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
    let cancelled = false;
    const loadWeather = () =>
      fetch("/api/weather", { cache: "no-store" })
        .then((response) => (response.ok ? (response.json() as Promise<DashboardWeather>) : null))
        .then((next) => {
          if (!cancelled && next) setWeather(next);
        })
        .catch(() => undefined);
    void loadWeather();
    queueMicrotask(() => void loadPanels());
    const timer = window.setInterval(() => void loadWeather(), 15 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadPanels]);

  async function createPanel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = question.trim();
    if (text.length < 3 || busy) return;
    setBusy("create");
    try {
      const response = await fetch("/api/panels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const payload = (await response.json().catch(() => ({}))) as { panel?: DashboardPanel; error?: string };
      if (!response.ok || !payload.panel) throw new Error(payload.error ?? "Vox couldn’t make that panel.");
      setPanels((current) => [...(current ?? []), payload.panel as DashboardPanel]);
      setQuestion("");
      setCreating(false);
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

  async function removePanel(id: string) {
    setPanels((current) => (current ?? []).filter((panel) => panel.id !== id));
    const response = await fetch(`/api/panels?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!response?.ok) {
      toast.error("Couldn’t remove the panel");
      void loadPanels();
    }
  }

  const soon = reminders.filter((reminder) => reminder.soon);
  const mail = briefing?.mail;
  const dueDecks = (briefing?.flashcards.decks ?? []).filter((deck) => deck.due > 0);
  const atLimit = (panels?.length ?? 0) >= MAX_DASHBOARD_PANELS;

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

      {(waiting.length > 0 || soon.length > 0) && (
        <section className="dash-panel" aria-labelledby="dash-waiting">
          <h2 id="dash-waiting" className="dash-kicker is-amber">Waiting on you</h2>
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
                  <span>{reminder.when}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {mail?.connected && mail.unread.length > 0 && (
        <section className="dash-panel" aria-labelledby="dash-mail">
          <h2 id="dash-mail" className="dash-kicker">Email worth reading</h2>
          <ul className="dash-rows">
            {mail.unread.slice(0, 3).map((message) => (
              <li key={message.id}>
                <div>
                  <strong>{plain(message.from, 60)}</strong>
                  <span>{plain(message.subject, 120)}</span>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="dash-link" onClick={onOpenToday}>
            See all in Today
          </button>
        </section>
      )}

      {dueDecks.length > 0 && (
        <section className="dash-panel" aria-labelledby="dash-study">
          <h2 id="dash-study" className="dash-kicker">Study</h2>
          <ul className="dash-rows">
            {dueDecks.slice(0, 2).map((deck) => (
              <li key={deck.id}>
                <div>
                  <strong>{plain(deck.title, 60)}</strong>
                  <span>{deck.due} cards due</span>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="dash-button" onClick={onStudy}>
            Study with Vox
          </button>
        </section>
      )}

      {(panels ?? []).map((panel) => (
        <section key={panel.id} className="dash-panel" aria-label={plain(panel.title, 80)}>
          <div className="dash-panel-head">
            <h2 className="dash-kicker">{plain(panel.title, 60)}</h2>
            <button type="button" className="dash-icon" aria-label={`Refresh ${plain(panel.title, 40)}`} disabled={busy !== null} onClick={() => void refreshPanel(panel.id)}>
              {busy === panel.id ? <Loader2 aria-hidden="true" className="animate-spin" /> : <RefreshCw aria-hidden="true" />}
            </button>
            <button type="button" className="dash-icon" aria-label={`Remove ${plain(panel.title, 40)}`} onClick={() => void removePanel(panel.id)}>
              <X aria-hidden="true" />
            </button>
          </div>
          {panel.blocks.slice(0, 2).map((block, index) => <PanelBlock key={index} block={block} />)}
          <p className="dash-note">
            {panel.sources[0] ? `${plain(panel.sources[0].site, 40)} · ` : ""}
            {new Date(panel.refreshedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        </section>
      ))}

      {creating ? (
        <form className="dash-panel" onSubmit={createPanel}>
          <label htmlFor="dash-new" className="dash-kicker">What should Vox keep an eye on?</label>
          <input
            id="dash-new"
            className="dash-input"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="USD to TWD rate, typhoon news, exam dates…"
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
        </form>
      ) : (
        <button type="button" className="dash-create" onClick={() => setCreating(true)} disabled={atLimit}>
          <Plus aria-hidden="true" /> {atLimit ? "Remove a panel to add another" : "Create a new panel"}
        </button>
      )}
    </aside>
  );
}
