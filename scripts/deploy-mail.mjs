// Deploys Vox Mail, the email site and MCP server for Vox.
// Needs MAIL_D1_DATABASE_ID (from `npx wrangler d1 create vox-mail`).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const help = `Usage: npm run mail:deploy [-- --help]

Applies mail-site's D1 migrations and deploys the vox-mail Worker.

Environment:
  MAIL_D1_DATABASE_ID    required; from \`npx wrangler d1 create vox-mail\`
  MAIL_VOX_URL           optional; the Vox deployment users sign in with
  CLOUDFLARE_WORKER_NAME optional; the Vox Worker's name (default vox-assistant)

Secrets, set once with \`npx wrangler secret put <NAME> --config mail-site/wrangler.jsonc\`:
  MAIL_TOKEN_SECRET                        required; encrypts tokens and app passwords
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   optional; enables Gmail
  MS_CLIENT_ID, MS_CLIENT_SECRET           optional; enables Outlook.com and Microsoft 365
See mail-site/README.md for the Google Cloud and Microsoft Entra setup.`;

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

const databaseId = process.env.MAIL_D1_DATABASE_ID?.trim();
if (!databaseId) {
  console.error("Set MAIL_D1_DATABASE_ID (npx wrangler d1 create vox-mail) before deploying.");
  process.exit(1);
}
const source = resolve("mail-site/wrangler.jsonc");
const output = resolve("mail-site/wrangler.deploy.json");
// Strip // comments so the JSONC config parses as JSON.
const config = JSON.parse(readFileSync(source, "utf8").replace(/^\s*\/\/.*$/gmu, ""));
config.d1_databases[0].database_id = databaseId;
if (process.env.MAIL_VOX_URL?.trim()) config.vars.VOX_URL = process.env.MAIL_VOX_URL.trim();
// Direct link to the Vox Worker on the same Cloudflare account.
config.services = [{ binding: "VOX", service: process.env.CLOUDFLARE_WORKER_NAME?.trim() || "vox-assistant" }];
delete config.$schema;
writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);

const wrangler = (...wranglerArgs) =>
  execFileSync("npx", ["wrangler", ...wranglerArgs, "--config", output], { stdio: "inherit" });
wrangler("d1", "migrations", "apply", "DB", "--remote");
wrangler("deploy");
console.log("\nIf this is the first deploy, set MAIL_TOKEN_SECRET and the Google and Microsoft client secrets you use (see mail-site/README.md).");
