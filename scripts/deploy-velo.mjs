// Deploys VÉLO, the voice notebook and MCP server for Vox (velo/, branch vox).
// Needs VELO_D1_DATABASE_ID (from `npx wrangler d1 create vox-velo`).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const help = `Usage: npm run velo:deploy [-- --help]

Applies velo's D1 migrations and deploys the vox-velo Worker.

Environment:
  VELO_D1_DATABASE_ID    required; from \`npx wrangler d1 create vox-velo\`
  VELO_VOX_URL           optional; the Vox deployment users sign in with
  CLOUDFLARE_WORKER_NAME optional; the Vox Worker's name (default vox-assistant)

Secret, set once with \`npx wrangler secret put VELO_TOKEN_SECRET --config velo/wrangler.jsonc\`:
  VELO_TOKEN_SECRET      required; keys the hashes of sessions and tokens in D1
See velo/README.md.`;

const args = process.argv.slice(2);
// Only print help: nothing below runs.
if (args.includes("--help") || args.includes("-h")) {
  console.log(help);
  process.exit(0);
}
if (args.length) {
  console.error(`Unknown option: ${args[0]}\n\n${help}`);
  process.exit(1);
}

const databaseId = process.env.VELO_D1_DATABASE_ID?.trim();
if (!databaseId) {
  console.error("Set VELO_D1_DATABASE_ID (npx wrangler d1 create vox-velo) before deploying.");
  process.exit(1);
}
const source = resolve("velo/wrangler.jsonc");
const output = resolve("velo/wrangler.deploy.json");
// Strip // comments so the JSONC config parses as JSON.
const config = JSON.parse(readFileSync(source, "utf8").replace(/^\s*\/\/.*$/gmu, ""));
config.d1_databases[0].database_id = databaseId;
if (process.env.VELO_VOX_URL?.trim()) config.vars.VOX_URL = process.env.VELO_VOX_URL.trim();
// Direct link to the Vox Worker on the same Cloudflare account.
config.services = [{ binding: "VOX", service: process.env.CLOUDFLARE_WORKER_NAME?.trim() || "vox-assistant" }];
delete config.$schema;
writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);

const wrangler = (...wranglerArgs) =>
  execFileSync("npx", ["wrangler", ...wranglerArgs, "--config", output], { stdio: "inherit" });
wrangler("d1", "migrations", "apply", "DB", "--remote");
wrangler("deploy");
console.log("\nIf this is the first deploy, set VELO_TOKEN_SECRET (see velo/README.md).");
