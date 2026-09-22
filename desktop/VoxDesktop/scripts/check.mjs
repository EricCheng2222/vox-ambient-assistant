import { access, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  approvedDesktopApp,
  isBlockedDesktopControlPrompt,
} from "../src/desktop-control-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "src/main.mjs",
  "src/computer-use-session.mjs",
  "src/desktop-control-policy.mjs",
  "src/preload.cjs",
  "src/vox-preload.cjs",
  "src/renderer.mjs",
  "src/shell.html",
  "src/shell.css",
  "resources/entitlements.mac.plist",
];

for (const file of files) await access(path.join(root, file));

for (const file of ["src/main.mjs", "src/computer-use-session.mjs", "src/desktop-control-policy.mjs", "src/preload.cjs", "src/vox-preload.cjs", "src/renderer.mjs"]) {
  const check = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
  if (check.status !== 0) throw new Error(check.stderr || `${file} failed syntax validation.`);
}

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.dependencies?.["@openai/codex-sdk"] !== "0.155.1") {
  throw new Error("The desktop app must pin the tested Codex SDK version.");
}

assert.equal(approvedDesktopApp("finder")?.bundleId, "com.apple.finder");
assert.equal(approvedDesktopApp("terminal"), null);
assert.equal(isBlockedDesktopControlPrompt("Delete this in Finder"), true);
assert.equal(isBlockedDesktopControlPrompt("Click the sidebar in Finder"), false);

console.log("Vox Desktop checks passed.");
