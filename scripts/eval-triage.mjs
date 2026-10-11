// Measures triage on real requests: sends each case in scripts/triage-cases.json
// to a running Vox server's router and reports how many end up on the expected
// route, with the old keyword rules and with lib/triage.ts.
//   node --experimental-strip-types scripts/eval-triage.mjs <server address> <cookie jar file> [cases file]
// The cookie jar is a curl -c file from signing in to that server.
import { readFileSync } from "node:fs";
const [, , base, jar, casesPath = new URL("./triage-cases.json", import.meta.url).pathname] = process.argv;
const { triage } = await import("../lib/triage.ts");
const { routeForOwnAccountTask, routeForLookup } = await import("../lib/browser-agent.ts");
const cookie = readFileSync(jar, "utf8").split("\n").filter((l) => l && !l.startsWith("# ")).map((l) => l.replace(/^#HttpOnly_/, "").split("\t")).filter((p) => p.length >= 7).map((p) => `${p[5]}=${p[6]}`).join("; ");
const cases = JSON.parse(readFileSync(casesPath, "utf8"));
const device = { browserAvailable: true, lookupMode: "auto" };
const rows = [];
const run = async ([text, expected]) => {
  const started = Date.now();
  const response = await fetch(`${base}/api/jev-route`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: base }, body: JSON.stringify({ text, pendingText: "", pendingAgeMs: 0, allowWait: false, recentMessages: [], replyLength: "balanced", visionAvailable: false, localCodexAvailable: true, desktopActionsAvailable: true, desktopControlAvailable: true }) });
  const payload = await response.json().catch(() => ({}));
  const want = expected.split("|");
  const first = payload.route;
  const before = routeForLookup(routeForOwnAccountTask(first, text, true), text, true, "auto");
  const after = triage({ route: first, where: payload.where, whereConfidence: payload.whereConfidence, text }, device);
  rows.push({ text, want, first, where: payload.where, conf: payload.whereConfidence, before, after: after.route, why: after.why, ms: Date.now() - started, provider: payload.source });
};
for (let i = 0; i < cases.length; i += 4) await Promise.all(cases.slice(i, i + 4).map(run));
const ok = (key) => rows.filter((r) => r.want.includes(r[key])).length;
const times = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`cases ${rows.length} | model's first choice alone ${ok("first")} | with keyword rules (before) ${ok("before")} | with new triage ${ok("after")} | median ${times[Math.floor(times.length / 2)]} ms | fallbacks ${rows.filter((r) => r.provider === "fallback").length}`);
for (const r of rows.filter((r) => !r.want.includes(r.after))) console.log(`  MISS "${r.text.slice(0, 62)}" first=${r.first} where=${r.where}(${r.conf}) -> ${r.after} [${r.why}] wanted ${r.want.join("|")}`);
for (const r of rows.filter((r) => r.want.includes(r.after) && !r.want.includes(r.before))) console.log(`  FIXED "${r.text.slice(0, 62)}" ${r.before} -> ${r.after} [${r.why}]`);
for (const r of rows.filter((r) => !r.want.includes(r.after) && r.want.includes(r.before))) console.log(`  BROKE "${r.text.slice(0, 62)}"`);
