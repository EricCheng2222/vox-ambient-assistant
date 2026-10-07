import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { weatherCondition, localClockTime, weatherPlace, approximateCoordinates, openMeteoUrl } = await import("../lib/weather.ts");
const { finishPanel, answerSentences, PanelBuildError, PANEL_TITLE_MAX } = await import("../lib/panel-builder.ts");
const { MAX_DASHBOARD_PANELS } = await import("../lib/dashboard.ts");
const { newPanelContent, editedPanelContent, isPanelEdit, panelBlocks } = await import("../lib/panel-input.ts");

// WMO codes become short English conditions.
for (const [code, condition] of [
  [0, "Clear"], [1, "Mostly clear"], [2, "Partly cloudy"], [3, "Overcast"], [45, "Fog"], [48, "Fog"],
  [51, "Drizzle"], [55, "Drizzle"], [56, "Freezing drizzle"], [61, "Light rain"], [63, "Rain"], [65, "Heavy rain"],
  [67, "Freezing rain"], [71, "Light snow"], [73, "Snow"], [75, "Heavy snow"], [77, "Snow grains"],
  [80, "Light showers"], [81, "Showers"], [82, "Heavy showers"], [86, "Snow showers"],
  [95, "Thunderstorm"], [96, "Thunderstorm with hail"], [99, "Thunderstorm with hail"],
]) assert.equal(weatherCondition(code), condition, String(code));
for (const unknown of [4, -1, 100, 1.5, "3", null, undefined]) assert.equal(weatherCondition(unknown), "Unknown");

// Sunrise and sunset keep Open-Meteo's local clock time as it is.
assert.equal(localClockTime("2026-10-07T05:52"), "05:52");
assert.equal(localClockTime("2026-10-07T17:34:10"), "17:34");
for (const bad of ["", "05:52", "2026-10-07T25:00", "2026-10-07T05:61", "2026-10-07T05:52Z", 1791352320, null, undefined]) {
  assert.equal(localClockTime(bad), null, String(bad));
}

assert.equal(weatherPlace("Banqiao", "TW"), "Banqiao, TW");
assert.equal(weatherPlace("  Kaohsiung‮ City ", "tw"), "Kaohsiung City, TW");
assert.equal(weatherPlace("Banqiao", undefined), "Banqiao");
assert.equal(weatherPlace("", "TW"), null);
assert.equal(weatherPlace(undefined, "TW"), null);

// Only a rounded position leaves for the weather service. Cloudflare gives strings.
assert.deepEqual(approximateCoordinates("25.01427", "121.46719"), { latitude: 25.01, longitude: 121.47 });
assert.deepEqual(approximateCoordinates(-33.8688, 151.2093), { latitude: -33.87, longitude: 151.21 });
for (const [lat, lon] of [[undefined, undefined], ["", ""], ["abc", "1"], [91, 0], [0, 181], [null, 5]]) {
  assert.equal(approximateCoordinates(lat, lon), null, `${lat},${lon}`);
}
assert.equal(
  openMeteoUrl({ latitude: 25.01, longitude: 121.47 }),
  "https://api.open-meteo.com/v1/forecast?latitude=25.01&longitude=121.47&current=temperature_2m%2Capparent_temperature%2Cweather_code%2Cis_day&daily=sunrise%2Csunset&timezone=auto&forecast_days=1",
);

// A panel never shows a map.
const facts = { kind: "facts", title: "Rate", rows: [{ label: "USD/TWD", value: "31.52" }] };
const map = { kind: "map", title: "Where", points: [{ id: "a", label: "A", lat: 1, lon: 2 }] };
assert.deepEqual(finishPanel("USD to TWD exchange rate", "The rate is 31.52.", { title: "USD to TWD", blocks: [map, facts] }), {
  title: "USD to TWD",
  blocks: [facts],
});
// A panel is never empty: without blocks, the answer's first sentences make a list.
const answer = "The rate is 31.52 today. It was 31.40 yesterday! Is it rising? Analysts expect more. And more.";
assert.deepEqual(finishPanel("USD to TWD exchange rate", answer, { title: "", blocks: [map] }), {
  title: "USD to TWD exchange rate",
  blocks: [{ kind: "list", title: "", items: ["The rate is 31.52 today.", "It was 31.40 yesterday!", "Is it rising?"] }],
});
assert.deepEqual(answerSentences("報名日期是5月3.5日。考試在7月！結果呢？之後公布。"), ["報名日期是5月3.5日。", "考試在7月！", "結果呢？"]);
assert.deepEqual(answerSentences("  One  fact with no full stop  "), ["One fact with no full stop"]);
assert.deepEqual(answerSentences(""), []);
assert.deepEqual(finishPanel("q?", "", { title: "", blocks: [] }).blocks, []);
// The title falls back to the question, cut to 60 characters.
const long = `${"KMU post-bacc medicine exam dates ".repeat(4)}`;
const fallback = finishPanel(long, "x.", { title: "  ", blocks: [facts] }).title;
assert.equal(PANEL_TITLE_MAX, 60);
assert.equal(fallback.length <= 60, true);
assert.equal(fallback.endsWith("…"), true);
assert.equal(fallback.startsWith("KMU post-bacc medicine exam dates KMU"), true);
assert.equal(finishPanel("  USD   to TWD ", "x.", { title: "", blocks: [facts] }).title, "USD to TWD");
assert.equal(finishPanel("q", "x.", { title: "T".repeat(90), blocks: [facts] }).title.length, 60);
assert.equal(new PanelBuildError("x").budget, false);
assert.equal(new PanelBuildError("x", true).budget, true);
assert.equal(new PanelBuildError("x") instanceof Error, true);

// Notes and countdowns: what a client sends is cleaned with the stage's block rules.
const list = { kind: "list", title: "", items: ["Passport", "Charger"] };
assert.deepEqual(newPanelContent({ kind: "note", title: "  Packing   list ", blocks: [{ kind: "list", items: ["Passport", " Charger ", "", 7] }, map, { kind: "video" }] }), {
  ok: true,
  panel: { kind: "note", title: "Packing list", blocks: [list], date: null },
});
assert.deepEqual(panelBlocks([map, facts, "x", null, { kind: "facts", rows: [] }]), [facts], "no map, no unknown or empty blocks");
assert.equal(panelBlocks(Array.from({ length: 9 }, () => facts)).length, 3, "at most three blocks");
assert.equal(panelBlocks([{ kind: "list", title: "T".repeat(500), items: Array.from({ length: 40 }, () => "i".repeat(900)) }])[0].items.length, 10);
assert.equal(panelBlocks([{ kind: "list", items: ["i".repeat(900)] }])[0].items[0].length, 200);
assert.deepEqual(panelBlocks("not blocks"), []);
assert.equal(newPanelContent({ kind: "note", title: "T".repeat(90), blocks: [list] }).panel.title.length, 60);
assert.deepEqual(newPanelContent({ kind: "note", title: "Empty", blocks: [map] }), { ok: false, error: "A note needs something to show." });
assert.deepEqual(newPanelContent({ kind: "note", title: "  ", blocks: [list] }), { ok: false, error: "Give the panel a title." });
assert.deepEqual(newPanelContent({ kind: "note", title: 5, blocks: [list] }), { ok: false, error: "Give the panel a title." });
assert.deepEqual(newPanelContent({ kind: "countdown", title: "Exam", date: "2027-03-07" }), {
  ok: true,
  panel: { kind: "countdown", title: "Exam", blocks: [], date: "2027-03-07" },
});
assert.deepEqual(newPanelContent({ kind: "countdown", title: "Exam", date: "2027-03-07", blocks: [facts, map] }).panel.blocks, [facts]);
for (const date of ["2027-02-30", "07/03/2027", "2027-3-7", "", null, undefined, 20270307]) {
  assert.deepEqual(newPanelContent({ kind: "countdown", title: "Exam", date }), { ok: false, error: "Give the date as YYYY-MM-DD." }, String(date));
}
assert.equal(newPanelContent({ kind: "video", title: "x" }).ok, false);
// Editing: only what was sent changes; a web panel is refreshed, not edited.
const note = { kind: "note", title: "Packing", blocks: [list], date: null };
const countdown = { kind: "countdown", title: "Exam", blocks: [], date: "2027-03-07" };
assert.equal(isPanelEdit({ id: "x" }), false);
for (const body of [{ title: "New" }, { blocks: [] }, { date: "2027-01-01" }, { title: null }]) assert.equal(isPanelEdit(body), true);
assert.deepEqual(editedPanelContent(note, { title: "Trip packing" }), { ok: true, panel: { ...note, title: "Trip packing" } });
assert.deepEqual(editedPanelContent(note, { blocks: [facts, map] }), { ok: true, panel: { ...note, blocks: [facts] } });
assert.deepEqual(editedPanelContent(note, { blocks: [] }), { ok: false, error: "A note needs something to show." });
assert.deepEqual(editedPanelContent(note, { title: "" }), { ok: false, error: "Give the panel a title." });
assert.deepEqual(editedPanelContent(note, { date: "2027-01-01" }), { ok: false, error: "Only a countdown has a date." });
assert.deepEqual(editedPanelContent(countdown, { date: "2027-03-14" }), { ok: true, panel: { ...countdown, date: "2027-03-14" } });
assert.deepEqual(editedPanelContent(countdown, { blocks: [facts], title: "KMU exam" }), { ok: true, panel: { kind: "countdown", title: "KMU exam", blocks: [facts], date: "2027-03-07" } });
assert.deepEqual(editedPanelContent(countdown, { date: "soon" }), { ok: false, error: "Give the date as YYYY-MM-DD." });
assert.deepEqual(editedPanelContent(countdown, { date: null }), { ok: false, error: "Give the date as YYYY-MM-DD." });
assert.deepEqual(editedPanelContent({ kind: "web", title: "USD", blocks: [facts] }, { title: "Dollar" }), {
  ok: false,
  error: "A panel looked up on the web can only be refreshed.",
});

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [weather, panels, store, builder, schema, migration, proxy] = await Promise.all([
  read("app/api/weather/route.ts"),
  read("app/api/panels/route.ts"),
  read("lib/panel-store.ts"),
  read("lib/panel-builder.ts"),
  read("db/schema.ts"),
  read("drizzle/0023_dashboard_panels.sql"),
  read("desktop/VoxDesktop/src/local-web-server.mjs"),
]);
// Weather needs the signed-in user, uses only the network's rough place, and fails quietly.
assert.match(weather, /export async function GET[^]*?requireUser\(request\)[^]*?\.cf;/u);
assert.match(weather, /approximateCoordinates\(cf\.latitude, cf\.longitude\)/u);
assert.match(weather, /AbortSignal\.timeout\(WEATHER_TIMEOUT_MS\)/u);
assert.match(weather, /WEATHER_TIMEOUT_MS = 5_000/u);
assert.match(weather, /"Cache-Control": "private, max-age=600"/u);
assert.doesNotMatch(weather, /status: (?:4|5)\d\d/u);
// Every panel route needs the user; every change must come from the same origin.
assert.equal(panels.match(/export async function (?:GET|POST|PATCH|DELETE)\(/gu).length, 4);
assert.equal(panels.match(/const auth = await requireUser\(request\);\n  if \("response" in auth\) return auth\.response;/gu).length, 4);
assert.equal(panels.match(/if \(!sameOrigin\(request\)\) return Response\.json\(\{ error: "Request not allowed\." \}, \{ status: 403, headers: noStore \}\);/gu).length, 3);
assert.doesNotMatch(panels, /Response\.json\((?:(?!headers: noStore)[^\n])*\);\n/u);
assert.match(panels, /question\.length < 3 \|\| question\.length > 200/u);
assert.match(panels, /status: 201, headers: noStore/u);
assert.match(panels, /error instanceof PanelLimitError\) return Response\.json\(\{ error: LIMIT_MESSAGE \}, \{ status: 409/u);
assert.match(panels, /error\.budget \? API_BUDGET_MESSAGE : LOOKUP_MESSAGE \}, \{ status: 503/u);
assert.match(panels, /buildPanel\(existing\.question, apiKey\)/u);
// Notes and countdowns are stored as sent (cleaned), without a web lookup or an OpenAI key.
assert.match(panels, /if \(body\.kind === "note" \|\| body\.kind === "countdown" \|\| body\.kind === "page" \|\| isOwnDataPanel\(body\.kind\)\) \{\n    const input = newPanelContent\(body\);\n    if \(!input\.ok\) return Response\.json\(\{ error: input\.error \}, \{ status: 400, headers: noStore \}\);[^]*?createPanel\(auth\.user\.id, \{ question: "", sources: \[\], \.\.\.input\.panel, \.\.\.pace \}\)[^]*?const apiKey = process\.env\.OPENAI_API_KEY;/u);
assert.match(panels, /createPanel\(auth\.user\.id, \{ kind: "web", question, \.\.\.built, refreshMinutes \}\)/u);
// How often a panel refreshes is one of the listed choices, saved without a lookup or a new age.
assert.match(panels, /if \(!editing && body\.refreshMinutes !== undefined\) \{[^]*?panelRefreshChoice\(body\.refreshMinutes\)[^]*?status: 400[^]*?updatePanel\(auth\.user\.id, id, \{ \.\.\.content, refreshMinutes \}, refreshedAt\)[^]*?buildPanel\(existing\.question, apiKey\)/u);
// Only web panels refresh; the others are edited.
assert.match(panels, /if \(existing\.kind !== "web"\) return Response\.json\(\{ error: REFRESH_MESSAGE \}, \{ status: 400, headers: noStore \}\);[^]*?buildPanel\(existing\.question, apiKey\)/u);
assert.match(panels, /REFRESH_MESSAGE = "Only panels looked up on the web can be refreshed\."/u);
assert.match(panels, /if \(editing\) \{[^]*?editedPanelContent\(existing, body\)[^]*?status: 400[^]*?updatePanel\(auth\.user\.id, body\.id, \{ question: "", sources: \[\], \.\.\.input\.panel, \.\.\.pace \}\)/u);
// The whole panel is encrypted with its own key and bound to its owner and id.
assert.match(store, /`dashboard-panels:\$\{secret\}`/u);
assert.match(store, /new TextEncoder\(\)\.encode\(`\$\{ownerId\}:\$\{id\}`\)/u);
assert.equal(store.match(/additionalData: panelBinding\(/gu).length, 2);
assert.match(store, /new TextEncoder\(\)\.encode\(JSON\.stringify\(payload\)\)/u);
assert.match(store, /type PanelPayload = \{ title: string; question: string; blocks: StageBlock\[\]; sources: StageSource\[\]; kind\?: DashboardPanel\["kind"\]; date\?: string \| null; refreshMinutes\?: number; url\?: string \}/u);
// The kind and date are inside the encrypted payload; panels saved before kinds existed are "web".
assert.match(store, /payload\.kind === "note" \|\| payload\.kind === "countdown" \|\| payload\.kind === "page" \|\| isOwnDataPanel\(payload\.kind\) \? payload\.kind : "web";/u);
assert.equal(store.match(/\.\.\.panelFields\(payload\)/gu).length, 3);
assert.doesNotMatch(migration, /title|question|blocks|sources/u);
assert.match(migration, /`ciphertext` text NOT NULL,\n\t`iv` text NOT NULL/u);
assert.match(schema, /sqliteTable\(\n  "dashboard_panels"/u);
// The limit holds, even for two requests at once; every query is the owner's.
assert.equal(MAX_DASHBOARD_PANELS, 8);
assert.match(store, /\(await countPanels\(ownerId\)\) >= MAX_DASHBOARD_PANELS\) \{\n\s+throw new PanelLimitError/u);
assert.match(store, /WHERE \(SELECT COUNT\(\*\) FROM dashboard_panels WHERE owner_id = \$\{ownerId\}\) < \$\{MAX_DASHBOARD_PANELS\}/u);
assert.match(panels, /countPanels\(auth\.user\.id\)\) >= MAX_DASHBOARD_PANELS[^]*?buildPanel\(question, apiKey\)/u);
assert.equal(store.match(/\.where\(/gu).length, store.match(/\.where\((?:and\([^\n]*)?eq\(dashboardPanels\.ownerId, ownerId\)/gu).length);
assert.match(store, /orderBy\(asc\(dashboardPanels\.position\), asc\(dashboardPanels\.createdAt\)\)/u);
// The lookup: a web search, then the stage's facts call in the question's language.
assert.match(builder, /model: "gpt-5\.6-terra"[^]*?reasoning: \{ effort: "low" \}[^]*?tools: \[\{ type: "web_search" \}\]/u);
assert.match(builder, /model: "gpt-5\.6-luna"[^]*?schema: STAGE_SCHEMA/u);
assert.match(builder, /selectResponseLanguage\(question\) === "taiwan_mandarin"/u);
assert.match(builder, /WEB_TIMEOUT_MS = 25_000;\nconst FACTS_TIMEOUT_MS = 8_000;/u);
assert.match(builder, /collectSources\(payload\)/u);
// The Mac app may reach both.
assert.match(proxy, /\["\/api\/weather", new Set\(\["GET"\]\)\]/u);
assert.match(proxy, /\["\/api\/panels", new Set\(\["GET", "POST", "PATCH", "DELETE"\]\)\]/u);
console.log("Dashboard checks passed.");
