import assert from "node:assert/strict";

const {
  defaultVisualTheme,
  isVisualTheme,
  parseVisualTheme,
  visualThemeOptions,
} = await import("../lib/visual-theme.ts");

assert.equal(defaultVisualTheme, "ambient");
assert.deepEqual(
  visualThemeOptions.map((option) => option.id),
  ["ambient", "neon"],
);
assert.equal(isVisualTheme("ambient"), true);
assert.equal(isVisualTheme("neon"), true);
assert.equal(isVisualTheme("unknown"), false);
assert.equal(parseVisualTheme("neon"), "neon");
assert.equal(parseVisualTheme("unknown"), "ambient");

console.log("Visual-theme checks passed.");
