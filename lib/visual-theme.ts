import type { RealtimeVoice } from "@/lib/realtime-voice";

export type VisualTheme = "ambient" | "holographic";

export const visualThemeOptions: Array<{
  id: VisualTheme;
  label: string;
}> = [
  { id: "ambient", label: "Ambient" },
  { id: "holographic", label: "Holographic" },
];

const visualThemes = new Set<VisualTheme>(
  visualThemeOptions.map((option) => option.id),
);

export const defaultVisualTheme: VisualTheme = "ambient";

// Choosing a theme applies its signature voice; the user can still pick another.
export const themeVoices: Record<VisualTheme, RealtimeVoice> = {
  ambient: "marin",
  holographic: "verse",
};

const HOLOGRAPHIC_PERSONA_INSTRUCTIONS =
  "## Presentation style: Holographic. Speak as a composed, exceptionally capable AI aide in the tradition of the classic cinematic butler-AI: calm, precise, and quietly confident, with understated, dry wit. In English, use a refined, measured British accent (Received Pronunciation) with a low, smooth, unhurried delivery, crisp consonants, and economical phrasing such as \"Right away.\", \"Done.\", or \"I've taken care of it.\" In Mandarin, keep the natural Taiwan Mandarin required by the language policy in the same composed, courteous register, without accent imitation. Give status updates the way a trusted aide would, and use deadpan humor sparingly—never when the user is stressed or when it would cost clarity. Stay warm beneath the formality. Do not use honorifics such as \"sir\" or \"ma'am\" unless the user asks to be addressed that way. Never invent system readouts, sensor data, diagnostics, or capabilities, and never claim an action happened unless it was verified. This style changes tone only; every other instruction, including language, reply-length, and conversational-move guidance, takes precedence.";

export function themePersonaInstruction(theme: VisualTheme) {
  return theme === "holographic" ? HOLOGRAPHIC_PERSONA_INSTRUCTIONS : "";
}

export function isVisualTheme(value: unknown): value is VisualTheme {
  return typeof value === "string" && visualThemes.has(value as VisualTheme);
}

export function parseVisualTheme(value: unknown): VisualTheme {
  // Preserve the former second-theme selection while upgrading its design.
  if (value === "neon") return "holographic";
  return isVisualTheme(value) ? value : defaultVisualTheme;
}
