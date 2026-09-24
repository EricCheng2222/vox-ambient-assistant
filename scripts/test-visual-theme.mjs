import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
assert.match(
  css,
  /data-vox-surface="desktop"[^}]+\.voice-console[^}]+grid-template-columns:\s*minmax\(0,\s*1fr\)/su,
);
assert.match(
  css,
  /data-vox-surface="desktop"[^}]+\.voice-console[^}]+justify-content:\s*stretch/su,
);

console.log("Visual-theme checks passed.");
