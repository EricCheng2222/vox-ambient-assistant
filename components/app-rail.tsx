"use client";

import type { LucideIcon } from "lucide-react";
import { AudioLines, CalendarDays, Library, SlidersHorizontal } from "lucide-react";

export type VoxView = "talk" | "today" | "library" | "settings";

export type AppRailStatusTone = "ok" | "warn" | "off";

const items: Array<{ view: VoxView; label: string; icon: LucideIcon }> = [
  { view: "talk", label: "Talk", icon: AudioLines },
  { view: "today", label: "Today", icon: CalendarDays },
  { view: "library", label: "Library", icon: Library },
  { view: "settings", label: "Settings", icon: SlidersHorizontal },
];

const toneWords: Record<AppRailStatusTone, string> = {
  ok: "connected",
  warn: "needs attention",
  off: "offline",
};

function itemLabel(view: VoxView, label: string, todayCount: number) {
  if (view !== "today" || todayCount <= 0) return label;
  return `${label}, ${todayCount} waiting on you`;
}

function Badge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="vx-badge" aria-hidden="true">
      {count > 99 ? "99+" : count}
    </span>
  );
}

/**
 * Vox's main navigation: a slim vertical rail on large screens and a bottom
 * tab bar below the lg breakpoint (the page keeps its own mic controls).
 * Render it inside `.vox-shell` so the theme styles apply.
 */
export function AppRail({
  view,
  onChange,
  todayCount = 0,
  statusLabel,
  statusTone = "ok",
}: {
  view: VoxView;
  onChange: (view: VoxView) => void;
  /** Items waiting on the user; shows an amber badge on Today when > 0. */
  todayCount?: number;
  /** Short status word under the rail, e.g. "MAC" or "CLOUD". */
  statusLabel?: string;
  statusTone?: AppRailStatusTone;
}) {
  return (
    <>
      <nav className="vx-rail" aria-label="Vox">
        <div className="brand-mark" aria-hidden="true">
          V
        </div>
        <ul className="vx-rail-list">
          {items.map(({ view: itemView, label, icon: Icon }) => (
            <li key={itemView}>
              <button
                type="button"
                className="vx-rail-item"
                aria-current={view === itemView ? "page" : undefined}
                aria-label={itemLabel(itemView, label, todayCount)}
                onClick={() => onChange(itemView)}
              >
                <Icon aria-hidden="true" strokeWidth={1.8} />
                <span aria-hidden="true">{label}</span>
                {itemView === "today" ? <Badge count={todayCount} /> : null}
              </button>
            </li>
          ))}
        </ul>
        <div className="vx-rail-spacer" />
        {statusLabel ? (
          <div className="vx-rail-status" title={`${statusLabel}: ${toneWords[statusTone]}`}>
            <span className="vx-dot" data-tone={statusTone} aria-hidden="true" />
            <span>
              {statusLabel}
              <span className="sr-only">, {toneWords[statusTone]}</span>
            </span>
          </div>
        ) : null}
      </nav>

      <nav className="vx-tabbar" aria-label="Vox">
        <ul className="vx-tabbar-list">
          {items.map(({ view: itemView, label, icon: Icon }) => (
            <li key={itemView}>
              <button
                type="button"
                className="vx-tab"
                aria-current={view === itemView ? "page" : undefined}
                aria-label={itemLabel(itemView, label, todayCount)}
                onClick={() => onChange(itemView)}
              >
                <Icon aria-hidden="true" strokeWidth={1.8} />
                <span aria-hidden="true">{label}</span>
                {itemView === "today" ? <Badge count={todayCount} /> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}
