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

export function isVisualTheme(value: unknown): value is VisualTheme {
  return typeof value === "string" && visualThemes.has(value as VisualTheme);
}

export function parseVisualTheme(value: unknown): VisualTheme {
  // Preserve the former second-theme selection while upgrading its design.
  if (value === "neon") return "holographic";
  return isVisualTheme(value) ? value : defaultVisualTheme;
}
