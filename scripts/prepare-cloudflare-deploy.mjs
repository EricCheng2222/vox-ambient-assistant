import { copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve("dist/server/wrangler.json");
const outputPath = resolve("dist/server/wrangler.deploy.json");
const workerEntryPath = resolve("dist/server/worker-entry.mjs");
const workerEntrySourcePath = resolve("cloudflare/worker-entry.mjs");
const sipControllerSourcePath = resolve("cloudflare/sip-call-durable-object.mjs");
const sipControllerOutputPath = resolve("dist/server/sip-call-durable-object.mjs");

const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID?.trim();
const bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim();
const databaseName =
  process.env.CLOUDFLARE_D1_DATABASE_NAME?.trim() || "vox-production";
const workerName =
  process.env.CLOUDFLARE_WORKER_NAME?.trim() || "vox-assistant";

if (!databaseId || !bucketName) {
  throw new Error(
    "Set CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_R2_BUCKET_NAME before preparing deployment.",
  );
}

const config = JSON.parse(await readFile(sourcePath, "utf8"));
config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [
  {
    binding: "DB",
    database_name: databaseName,
    database_id: databaseId,
    migrations_dir: "../../drizzle",
  },
];
config.r2_buckets = [
  {
    binding: "BUCKET",
    bucket_name: bucketName,
  },
];
config.main = "worker-entry.mjs";
config.durable_objects = {
  bindings: [
    {
      name: "SIP_CALLS",
      class_name: "SipCallDurableObject",
    },
  ],
};
// Direct link to the Vox Flash Cards Worker: Workers on one account cannot
// fetch each other's workers.dev URLs, so server-to-server calls use this.
config.services = [
  { binding: "FLASHCARDS", service: process.env.FLASHCARDS_WORKER_NAME?.trim() || "vox-flashcards" },
];
// Every minute: place phone calls for reminders that asked to be delivered by call.
config.triggers = { crons: ["* * * * *"] };
config.migrations = [
  {
    tag: "sip-calls-v1",
    new_sqlite_classes: ["SipCallDurableObject"],
  },
];

await copyFile(sipControllerSourcePath, sipControllerOutputPath);
await copyFile(workerEntrySourcePath, workerEntryPath);
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared ${outputPath} for Worker ${workerName}.`);
