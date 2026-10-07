import type { StageBlock, StageSource } from "@/lib/stage";

// The dashboard's panels: weather for roughly where you are, and panels you
// asked Vox to make and keep ("USD to TWD", "KMU exam dates").

/** GET /api/weather. Location is approximate (from the network, not GPS). */
export type DashboardWeather =
  | { available: false }
  | {
      available: true;
      /** "Banqiao, TW" */
      place: string | null;
      temperatureC: number;
      feelsLikeC: number;
      /** "Overcast", "Light rain", … */
      condition: string;
      isDay: boolean;
      /** Local clock times as "HH:MM", or null. */
      sunrise: string | null;
      sunset: string | null;
    };

/**
 * A panel the user (or Vox, when asked) made. Blocks never include a map.
 * - "web": looked up on the web from `question`; refreshable.
 * - "note": content Vox wrote (a packing list, a plan); `question` is "".
 * - "countdown": days until `date` ("2027-03-07"); blocks may add details.
 * - "messages": live: the newest texts to Vox's number and the emails that
 *   need the user. Nothing is stored but the title; the page fills it in.
 * - "calendar", "tasks": live: the user's coming events and open to-dos,
 *   from their connected Google account. Only the title is stored.
 * - "page": live: a web page (`url`) the Mac app keeps an eye on from the
 *   built-in browser's profile, where the user signed in themselves. Only the
 *   title and address are stored; what the page says stays on that Mac.
 */
export type DashboardPanel = {
  id: string;
  kind: "web" | "note" | "countdown" | "messages" | "calendar" | "tasks" | "page";
  title: string;
  question: string;
  blocks: StageBlock[];
  sources: StageSource[];
  /** Watched page: its https address. */
  url?: string;
  /** Countdown target, as a calendar date. */
  date?: string | null;
  /** Web and messages panels: minutes between automatic refreshes (0.5 = 30 seconds); 0 means only when asked. */
  refreshMinutes?: number;
  refreshedAt: string;
};

/** How often a web panel may refresh itself. */
export const PANEL_REFRESH_CHOICES = [
  { minutes: 0, label: "Only when I ask" },
  { minutes: 0.5, label: "Every 30 seconds" },
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 1440, label: "Once a day" },
] as const;
export const DEFAULT_PANEL_REFRESH_MINUTES = 60;

/** Panels fed live from the user's own data; only their title is stored. */
export const OWN_DATA_PANEL_KINDS = ["messages", "calendar", "tasks"] as const;
export type OwnDataPanelKind = (typeof OWN_DATA_PANEL_KINDS)[number];
export function isOwnDataPanel(kind: unknown): kind is OwnDataPanelKind {
  return OWN_DATA_PANEL_KINDS.includes(kind as OwnDataPanelKind);
}
/** Messages are checked against Vox's own data, so a fast pace costs nothing. */
export const DEFAULT_MESSAGES_REFRESH_MINUTES = 0.5;

export function defaultPanelRefresh(kind: DashboardPanel["kind"]) {
  if (kind === "messages") return DEFAULT_MESSAGES_REFRESH_MINUTES;
  // Re-reading a page on the user's Mac costs nothing either, but stays gentle on the site.
  return kind === "page" || kind === "calendar" || kind === "tasks" ? 15 : DEFAULT_PANEL_REFRESH_MINUTES;
}

/** One of the allowed intervals, or null for anything else. */
export function panelRefreshChoice(value: unknown): number | null {
  return PANEL_REFRESH_CHOICES.some((choice) => choice.minutes === value) ? (value as number) : null;
}

/**
 * True when a panel is due for its automatic refresh. `lastRefreshed` is when
 * it last was, for panels whose content isn't stored (messages).
 */
export function panelIsDue(
  panel: Pick<DashboardPanel, "kind" | "refreshMinutes" | "refreshedAt">,
  now = Date.now(),
  lastRefreshed?: number,
) {
  if (panel.kind !== "web" && panel.kind !== "page" && !isOwnDataPanel(panel.kind)) return false;
  const minutes = panelRefreshChoice(panel.refreshMinutes) ?? defaultPanelRefresh(panel.kind);
  const refreshed = lastRefreshed ?? Date.parse(panel.refreshedAt);
  return minutes > 0 && Number.isFinite(refreshed) && now - refreshed >= minutes * 60_000;
}

/** An https address with no sign-in details in it, normalized; or null. */
export function watchablePageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export const MAX_DASHBOARD_PANELS = 8;
