import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { visualThemeOptions, parseVisualTheme, themeVoices, themePersonaInstruction } = await import("../lib/visual-theme.ts");
assert.deepEqual(visualThemeOptions.map((option) => option.id), ["ambient", "holographic", "daylight"]);
assert.equal(parseVisualTheme("daylight"), "daylight");
assert.equal(parseVisualTheme("nonsense"), "ambient");
assert.ok(themeVoices.daylight);
assert.equal(themePersonaInstruction("daylight"), "");

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [css, page, mailRoute, panels] = await Promise.all([
  read("app/daylight.css"), read("app/page.tsx"), read("app/api/connections/mail/route.ts"), read("components/dashboard-panels.tsx"),
]);
// Everything is scoped to the theme, so the other two themes are untouched.
for (const rule of css.split("}\n").map((block) => block.split("{")[0].trim()).filter((selector) => selector && !selector.startsWith("/*") && !selector.startsWith("@") && !selector.startsWith("from") && !selector.startsWith("to"))) {
  const selectors = rule.split(/,\s*\n/u).map((selector) => selector.replace(/\/\*[\s\S]*?\*\//gu, "").trim()).filter(Boolean);
  for (const selector of selectors) {
    assert.ok(/data-vox-theme="daylight"|^\.dash/u.test(selector), `unscoped rule: ${selector}`);
  }
}
// The dashboard column only exists in Daylight, for a signed-in account.
assert.match(page, /\{theme === "daylight" && todayAvailable && \(\n\s+<DashboardPanels/u);
// One-click connect: the button names the provider and Vox passes it on.
assert.match(panels, /openMailConnection\(\{ provider: "google" \}\)/u);
assert.match(mailRoute, /started\.searchParams\.set\("provider", body\.provider\)/u);
assert.match(mailRoute, /body\.provider === "google" \|\| body\.provider === "microsoft" \|\| body\.provider === "imap"/u);
console.log("Daylight theme checks passed.");
{
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  // In Daylight the conversation always has the middle, whatever was last chosen elsewhere.
  assert.match(page, /const sidePanelSwitch = todayAvailable && theme !== "daylight";\n\s+const showingToday = sidePanelSwitch && sidePanel === "today";/u);
  console.log("Daylight keeps the conversation in the middle.");
}
