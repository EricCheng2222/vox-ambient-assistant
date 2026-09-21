export type VisualTheme = "ambient" | "neon";

export const visualThemeOptions: Array<{
  id: VisualTheme;
  label: string;
}> = [
  { id: "ambient", label: "Ambient" },
  { id: "neon", label: "Neon" },
];

const visualThemes = new Set<VisualTheme>(
  visualThemeOptions.map((option) => option.id),
);

export const defaultVisualTheme: VisualTheme = "ambient";

export function isVisualTheme(value: unknown): value is VisualTheme {
  return typeof value === "string" && visualThemes.has(value as VisualTheme);
}

export function parseVisualTheme(value: unknown): VisualTheme {
  return isVisualTheme(value) ? value : defaultVisualTheme;
}
