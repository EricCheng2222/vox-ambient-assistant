import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const {
  defaultVisualTheme,
  isVisualTheme,
  parseVisualTheme,
  themePersonaInstruction,
  themeVoices,
  visualThemeOptions,
} = await import("../lib/visual-theme.ts");

// Two themes share one layout: Sunset (the default) and Sunrise. The earlier dark themes are gone.
assert.equal(defaultVisualTheme, "sunset");
assert.deepEqual(
  visualThemeOptions.map((option) => option.id),
  ["sunset", "daylight"],
);
assert.equal(isVisualTheme("sunset"), true);
assert.equal(isVisualTheme("daylight"), true);
for (const gone of ["ambient", "holographic", "neon", "unknown"]) {
  assert.equal(isVisualTheme(gone), false, gone);
  assert.equal(parseVisualTheme(gone), "sunset", `${gone} becomes Sunset`);
}
assert.equal(parseVisualTheme("daylight"), "daylight");
assert.deepEqual(Object.keys(themeVoices).sort(), ["daylight", "sunset"]);
assert.equal(themePersonaInstruction("sunset"), themePersonaInstruction("daylight"));
assert.doesNotMatch(themePersonaInstruction("sunset"), /British accent/u);

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
