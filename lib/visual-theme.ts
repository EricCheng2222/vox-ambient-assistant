import type { RealtimeVoice } from "@/lib/realtime-voice";

import { DAYLIGHT_PERSONA_INSTRUCTIONS } from "./proactive.ts";

export type VisualTheme = "daylight" | "sunset";

export const visualThemeOptions: Array<{
  id: VisualTheme;
  label: string;
}> = [
  // Dusk turning to night: light text under a dark sky, the default.
  { id: "sunset", label: "Sunset" },
  // The same layout by day: a soft morning sky.
  { id: "daylight", label: "Sunrise" },
];

const visualThemes = new Set<VisualTheme>(
  visualThemeOptions.map((option) => option.id),
);

export const defaultVisualTheme: VisualTheme = "sunset";

// Choosing a theme applies its signature voice; the user can still pick another.
export const themeVoices: Record<VisualTheme, RealtimeVoice> = {
  daylight: "marin",
  sunset: "marin",
};

export function themePersonaInstruction(theme: VisualTheme) {
  return themeLook(theme) === "daylight" ? DAYLIGHT_PERSONA_INSTRUCTIONS : "";
}

/**
 * The layout and behaviour a theme uses. Sunset is Sunrise in other colours,
 * so everything written for "daylight" applies to it; only the tone differs.
 */
export function themeLook(theme: VisualTheme): "daylight" {
  return theme === "sunset" ? "daylight" : theme;
}

export function isVisualTheme(value: unknown): value is VisualTheme {
  return typeof value === "string" && visualThemes.has(value as VisualTheme);
}

export function parseVisualTheme(value: unknown): VisualTheme {
  // The earlier dark themes (Ambient, Holographic) are gone; anyone who had one gets Sunset.
  return isVisualTheme(value) ? value : defaultVisualTheme;
}
