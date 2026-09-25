// Deploys Vox Flash Cards, the independent flash-card site and MCP server.
// Needs FLASHCARDS_D1_DATABASE_ID (from `npx wrangler d1 create vox-flashcards`).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const databaseId = process.env.FLASHCARDS_D1_DATABASE_ID?.trim();
if (!databaseId) {
  throw new Error("Set FLASHCARDS_D1_DATABASE_ID (npx wrangler d1 create vox-flashcards) before deploying.");
}
const source = resolve("flashcards-site/wrangler.jsonc");
const output = resolve("flashcards-site/wrangler.deploy.json");
// Strip // comments so the JSONC config parses as JSON.
const config = JSON.parse(readFileSync(source, "utf8").replace(/^\s*\/\/.*$/gmu, ""));
config.d1_databases[0].database_id = databaseId;
if (process.env.FLASHCARDS_VOX_URL?.trim()) config.vars.VOX_URL = process.env.FLASHCARDS_VOX_URL.trim();
// Direct link to the Vox Worker on the same Cloudflare account.
config.services = [{ binding: "VOX", service: process.env.CLOUDFLARE_WORKER_NAME?.trim() || "vox-assistant" }];
delete config.$schema;
writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);

const wrangler = (...args) =>
  execFileSync("npx", ["wrangler", ...args, "--config", output], { stdio: "inherit" });
wrangler("d1", "migrations", "apply", "DB", "--remote");
wrangler("deploy");
