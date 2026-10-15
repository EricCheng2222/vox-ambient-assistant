// VÉLO is an independent repository, so its presentation has a local snapshot.
// Run before validating a companion design change; never add a runtime import
// from VÉLO to files outside its checkout. `--check` only reports drift and
// exits non-zero, for tests and CI.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = new URL("../lib/apple-site.ts", import.meta.url);
const target = new URL("../velo/src/apple-site.ts", import.meta.url);
const header = "// Companion design snapshot from Vox lib/apple-site.ts. Kept local so this\n// independent repository still builds and runs without the parent checkout.\n";
const check = process.argv.includes("--check");

if (!existsSync(new URL("../velo/src/", import.meta.url))) {
  console.error(`VÉLO isn't checked out at ${fileURLToPath(new URL("../velo/", import.meta.url))}. Run: git submodule update --init velo`);
  process.exit(1);
}

const expected = header + readFileSync(source, "utf8");
const current = existsSync(target) ? readFileSync(target, "utf8") : null;
if (current === expected) {
  console.log("Companion design styles are synchronized.");
} else if (check) {
  console.error("VÉLO's design snapshot is out of date. Run: node scripts/sync-companion-design.mjs");
  process.exit(1);
} else {
  writeFileSync(target, expected);
  console.log("Updated VÉLO's companion design snapshot.");
}
