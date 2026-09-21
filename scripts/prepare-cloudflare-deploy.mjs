import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const sourcePath = resolve("dist/server/wrangler.json");
const outputPath = resolve("dist/server/wrangler.deploy.json");

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

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Prepared ${outputPath} for Worker ${workerName}.`);
