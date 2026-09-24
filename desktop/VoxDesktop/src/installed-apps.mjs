import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import path from "node:path";

const exec = promisify(execFile);
const installedAppsCacheTtlMs = 6 * 60 * 60 * 1000;
let cached;
let refreshedAt = 0;
let refreshPromise;

export async function installedApps() {
  if (cached && Date.now() - refreshedAt < installedAppsCacheTtlMs) return cached;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const apps = [];
    async function scan(directory, depth = 0) {
      const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const location = path.join(directory, entry.name);
        if (entry.name.endsWith(".app")) {
          try {
            const { stdout } = await exec("/usr/bin/plutil", ["-convert", "json", "-o", "-", path.join(location, "Contents/Info.plist")], { timeout: 3000 });
            const info = JSON.parse(stdout);
            if (typeof info.CFBundleIdentifier !== "string" || !/^[\w.-]+$/.test(info.CFBundleIdentifier)) continue;
            const name = entry.name.slice(0, -4);
            const aliases = [...new Set([name, info.CFBundleDisplayName, info.CFBundleName].filter(value => typeof value === "string" && value.length > 1))];
            apps.push({ id: `installed:${info.CFBundleIdentifier}`, name, bundleId: info.CFBundleIdentifier, path: location, aliases });
          } catch { /* Unreadable application bundles are not actionable. */ }
        } else if (depth < 2 && !entry.name.startsWith(".")) {
          await scan(location, depth + 1);
        }
      }
    }
    await Promise.all(["/Applications", "/System/Applications", path.join(homedir(), "Applications")].map(root => scan(root)));
    cached = apps;
    refreshedAt = Date.now();
    return apps;
  })();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = undefined;
  }
}

export function matchInstalledApp(text, apps) {
  if (typeof text !== "string" || text.length > 12_000) return null;
  const matches = apps.flatMap(app => app.aliases.filter(alias => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "iu").test(text);
  }).map(alias => ({ app, alias })));
  matches.sort((a, b) => b.alias.length - a.alias.length);
  if (!matches.length) return null;
  const best = matches[0];
  if (matches.some(match => match.alias.length === best.alias.length && match.app.bundleId !== best.app.bundleId)) return null;
  const remainder = text.toLowerCase().replace(best.alias.toLowerCase(), "").replace(/(?:mac|的|這個|那個|程式|應用程式|app)|[\s.!?。！？]/giu, "");
  return { id: best.app.id, name: best.app.name, appOnly: remainder.length === 0 };
}
