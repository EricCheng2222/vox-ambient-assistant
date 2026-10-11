// Vox updating itself, carefully. In order, stopping at the first thing that
// is not right:
//
//   1. the full regression run must pass, for exactly the code that is here now;
//   2. the server is deployed;
//   3. the Mac app is built;
//   4. the Mac must not be in the middle of a task for the user;
//   5. the app that is installed now is kept aside, the new one is installed and started;
//   6. if the new one does not come up, the one kept aside is put back.
//
//   node scripts/update-vox.mjs            do it
//   node scripts/update-vox.mjs --check    steps 1 and 4 only: say whether an update could go ahead, change nothing
//
// It is started by a person (from a terminal, or the Update button in the Mac
// app's own window), never by anything Vox read or was told.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fingerprint } from "./regression.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");
const INSTALLED = "/Applications/Vox.app";
const KEPT = join(homedir(), "Library", "Application Support", "Vox", "previous", "Vox.app");
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (text) => console.log(`[update] ${text}`);
const stop = (text) => {
  say(`Stopped: ${text} Nothing further was changed.`);
  process.exit(1);
};

// The deployment's settings, read here so the app that starts this does not need them.
const env = { ...process.env };
for (const line of readFileSync(join(root, ".env.cloudflare"), "utf8").split("\n")) {
  const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line.trim());
  if (match) env[match[1]] = match[2].replace(/^["']|["']$/gu, "");
}
const run = (command, args, options = {}) => spawnSync(command, args, { cwd: root, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
const installedVersion = () => {
  try {
    return execFileSync("defaults", ["read", `${INSTALLED}/Contents/Info`, "CFBundleShortVersionString"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const running = () => spawnSync("pgrep", ["-x", "Vox"]).status === 0;

// 1. The regression run, for this exact code.
say("Running every check before anything is changed…");
const regression = run("node", ["scripts/regression.mjs"], { stdio: ["ignore", "pipe", "pipe"], timeout: 1_200_000 });
let result = null;
try {
  result = JSON.parse(readFileSync(join(root, ".vox-regression.json"), "utf8"));
} catch {
  result = null;
}
if (regression.status !== 0 || !result?.passed) stop(`the checks did not all pass${result?.failed?.length ? ` (${result.failed.join(", ")})` : ""}.`);
if (result.quick) stop("only the quick checks were run.");
if (result.fingerprint !== fingerprint(root)) stop("the code changed after the checks ran.");
say(`All ${result.steps} checks passed.`);

// 4 (asked early as well, so a check-only run can answer): is the Mac busy for the user?
function macBusy() {
  if (run("npm", ["run", "-s", "deploy:prepare"]).status !== 0) return "unknown";
  const query = run("npx", ["wrangler", "d1", "execute", "vox-production", "--remote", "--config", "dist/server/wrangler.deploy.json", "--json", "--command", "select (select count(*) from answer_jobs where response_id = 'mac-task' and status = 'running') + (select count(*) from remote_commands where status in ('pending','claimed','running') and created_at > datetime('now', '-10 minutes')) as busy"]);
  try {
    return JSON.parse(query.stdout)[0].results[0].busy > 0 ? "busy" : "idle";
  } catch {
    return "unknown";
  }
}

if (checkOnly) {
  const busy = macBusy();
  say(busy === "idle" ? "An update could go ahead now." : busy === "busy" ? "The checks pass, but the Mac is in the middle of something for you." : "The checks pass, but whether the Mac is busy could not be read.");
  process.exit(busy === "idle" ? 0 : 2);
}

// 2. The server.
say("Deploying the server…");
if (run("npm", ["run", "-s", "deploy:prepare"]).status !== 0) stop("the server could not be prepared.");
let deployed = false;
for (let attempt = 0; attempt < 4 && !deployed; attempt += 1) {
  if (attempt) await sleep(8_000);
  deployed = /Uploaded/u.test(`${run("npm", ["run", "-s", "deploy:worker"]).stdout ?? ""}`);
}
if (!deployed) stop("the server did not accept the new version.");

// 3. The Mac app, one version on from the one installed.
say("Building the Mac app…");
const packagePath = join(root, "desktop", "VoxDesktop", "package.json");
const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
const before = installedVersion();
if (before && manifest.version === before) {
  const parts = before.split(".").map(Number);
  manifest.version = `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  writeFileSync(packagePath, `${JSON.stringify(manifest, null, 2)}\n`);
}
const desktop = join(root, "desktop", "VoxDesktop");
if (run("npm", ["run", "-s", "dist"], { cwd: desktop, timeout: 900_000 }).status !== 0 || !existsSync(join(desktop, "dist", "mac-arm64", "Vox.app"))) {
  stop("the Mac app did not build. The server is already on the new version; the Mac app is unchanged.");
}
for (const leftover of ["zip", "dmg", "blockmap"]) spawnSync("/bin/sh", ["-c", `rm -f "${desktop}/dist/"Vox-*-arm64*.${leftover}*`]);

// 4. Not while it is working for the user.
if (macBusy() !== "idle") stop("the Mac is in the middle of something for you (or that could not be read). The new app is built and waiting; run this again in a moment.");

// 5. Keep the old one, put in the new one.
say(`Installing ${manifest.version} (keeping ${before || "the current app"} aside)…`);
rmSync(KEPT, { recursive: true, force: true });
if (existsSync(INSTALLED)) cpSync(INSTALLED, KEPT, { recursive: true, verbatimSymlinks: true });
spawnSync("osascript", ["-e", 'quit app "Vox"']);
await sleep(4_000);
rmSync(INSTALLED, { recursive: true, force: true });
spawnSync("ditto", [join(desktop, "dist", "mac-arm64", "Vox.app"), INSTALLED]);
spawnSync("open", ["-a", INSTALLED]);

// 6. It has to come up.
let up = false;
for (let waited = 0; waited < 30_000 && !up; waited += 2_000) {
  await sleep(2_000);
  up = running() && installedVersion() === manifest.version;
}
if (!up) {
  say("The new app did not start. Putting the previous one back…");
  spawnSync("osascript", ["-e", 'quit app "Vox"']);
  await sleep(2_000);
  rmSync(INSTALLED, { recursive: true, force: true });
  if (existsSync(KEPT)) spawnSync("ditto", [KEPT, INSTALLED]);
  spawnSync("open", ["-a", INSTALLED]);
  stop(`version ${manifest.version} did not start, so ${before || "the previous app"} was put back. The server is on the new version.`);
}
say(`Done. Vox ${manifest.version} is running; ${before || "the previous app"} is kept in case it is needed.`);
