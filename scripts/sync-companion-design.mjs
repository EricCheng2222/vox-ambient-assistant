// VÉLO is an independent repository, so its presentation has a local snapshot.
// Run before validating a companion design change; never add a runtime import
// from VÉLO to files outside its checkout.
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../lib/apple-site.ts", import.meta.url);
const target = new URL("../velo/src/apple-site.ts", import.meta.url);
const header = "// Companion design snapshot from Vox lib/apple-site.ts. Kept local so this\n// independent repository still builds and runs without the parent checkout.\n";
const expected = header + readFileSync(source, "utf8");
if (readFileSync(target, "utf8") !== expected) writeFileSync(target, expected);
console.log("Companion design styles are synchronized.");
