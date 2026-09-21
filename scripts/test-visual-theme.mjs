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
  ["ambient", "holographic"],
);
assert.equal(isVisualTheme("ambient"), true);
assert.equal(isVisualTheme("holographic"), true);
assert.equal(isVisualTheme("neon"), false);
assert.equal(isVisualTheme("unknown"), false);
assert.equal(parseVisualTheme("holographic"), "holographic");
assert.equal(parseVisualTheme("neon"), "holographic");
assert.equal(parseVisualTheme("unknown"), "ambient");

console.log("Visual-theme checks passed.");
