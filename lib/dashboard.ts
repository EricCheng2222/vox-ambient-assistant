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

/** A panel the user asked for. Blocks never include a map. */
export type DashboardPanel = {
  id: string;
  title: string;
  /** What the user asked to keep an eye on; used to refresh it. */
  question: string;
  blocks: StageBlock[];
  sources: StageSource[];
  refreshedAt: string;
};

export const MAX_DASHBOARD_PANELS = 8;
