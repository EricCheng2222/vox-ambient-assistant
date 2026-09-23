import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvedDesktopApp,
  isBlockedDesktopControlPrompt,
  isDraftOnlyDesktopControlPrompt,
} from "../src/desktop-control-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "src/main.mjs",
  "src/computer-use-session.mjs",
  "src/desktop-control-policy.mjs",
  "src/personal-api.mjs",
  "src/personal-route.mjs",
  "src/local-web-server.mjs",
  "src/dyson-local.mjs",
  "src/smart-home-hub.mjs",
  "src/preload.cjs",
  "src/vox-preload.cjs",
  "src/renderer.mjs",
  "src/shell.html",
  "src/shell.css",
  "resources/entitlements.mac.plist",
];

for (const file of files) await access(path.join(root, file));

for (const file of ["src/main.mjs", "src/computer-use-session.mjs", "src/desktop-control-policy.mjs", "src/personal-api.mjs", "src/personal-route.mjs", "src/local-web-server.mjs", "src/dyson-local.mjs", "src/smart-home-hub.mjs", "src/preload.cjs", "src/vox-preload.cjs", "src/renderer.mjs"]) {
  const check = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(check.stderr || `${file} failed syntax validation.`);
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.dependencies?.["@openai/codex-sdk"] !== "0.155.1") {
  throw new Error("The desktop app must pin the tested Codex SDK version.");
}

const mainSource = await readFile(path.join(root, "src/main.mjs"), "utf8");
const trustedOriginBlock = mainSource.match(/const trustedOrigins = \[([\s\S]*?)\];/u)?.[1] ?? "";
assert.doesNotMatch(trustedOriginBlock, /productionUrl/u);
assert.match(mainSource, /app\.isPackaged && developmentUrl \? developmentUrl : localVoxServer\.url/u);
assert.match(mainSource, /desktopSessionHeader/u);
assert.match(mainSource, /session\.defaultSession\.fetch\(request/u);

assert.equal(approvedDesktopApp("finder")?.bundleId, "com.apple.finder");
assert.equal(approvedDesktopApp("terminal"), null);
assert.equal(isBlockedDesktopControlPrompt("Delete this in Finder"), true);
assert.equal(isBlockedDesktopControlPrompt("Click the sidebar in Finder"), false);
assert.equal(isDraftOnlyDesktopControlPrompt("幫我在 LINE 裡打一下，我自己發送"), true);
assert.equal(isBlockedDesktopControlPrompt("幫我在 LINE 裡打一下，我自己發送"), false);
assert.equal(isDraftOnlyDesktopControlPrompt("幫我在 LINE 裡打好然後送出"), true);
assert.equal(isBlockedDesktopControlPrompt("幫我在 LINE 裡打好然後送出"), false);
assert.equal(isBlockedDesktopControlPrompt("Click Send in LINE"), true);

console.log("Vox Desktop checks passed.");
