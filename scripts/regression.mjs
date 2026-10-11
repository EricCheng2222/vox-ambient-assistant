// Vox's regression run: everything that can be checked without a person,
// before Vox is allowed to update itself (scripts/update-vox.mjs refuses to
// go on unless this passed for exactly the code that is about to ship).
//
//   node scripts/regression.mjs            run it all, print one line per step
//   node scripts/regression.mjs --quick    skip the build (the slowest step)
//
// The result is written to .vox-regression.json with a fingerprint of the
// code it was run against: change one file afterwards and the pass no longer counts.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const quick = process.argv.includes("--quick");

/** The code as it stands: the commit, plus every uncommitted change, here and in the nested VÉLO repository. */
export function fingerprint(folder = root) {
  const git = (args, cwd = folder) => {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    } catch {
      return "";
    }
  };
  const hash = createHash("sha256");
  for (const cwd of [folder, join(folder, "velo")]) {
    hash.update(git(["rev-parse", "HEAD"], cwd));
    hash.update(git(["status", "--porcelain"], cwd));
    hash.update(git(["diff", "HEAD"], cwd));
    // New files are not in the diff: their contents count too.
    for (const file of git(["ls-files", "--others", "--exclude-standard"], cwd).split("\n").filter(Boolean)) {
      hash.update(file);
      hash.update(git(["hash-object", file], cwd));
    }
  }
  return hash.digest("hex").slice(0, 24);
}

const node = (file) => ["node", ["--experimental-strip-types", "--no-warnings", file]];
const steps = [
  ...readdirSync(join(root, "scripts"))
    .filter((name) => /^test-.*\.mjs$/u.test(name) && name !== "test-installed-apps.mjs")
    .sort()
    .map((name) => ({ name: name.replace(/^test-|\.mjs$/gu, ""), group: "Vox", run: node(`scripts/${name}`) })),
  { name: "notebook", group: "VÉLO", run: node("velo/test/velo.test.mjs") },
  ...["mail", "site", "google", "imap", "unit"].map((name) => ({ name, group: "Mail", run: node(`mail-site/test/${name}.test.mjs`) })),
  { name: "types", group: "VÉLO", run: ["npx", ["tsc", "-p", "velo"]] },
  { name: "types", group: "Mail", run: ["npx", ["tsc", "-p", "mail-site"]] },
  { name: "lint", group: "Code", run: ["npx", ["eslint", ".", "--ignore-pattern", "dist", "--ignore-pattern", ".next", "--ignore-pattern", "desktop/VoxDesktop/dist", "--max-warnings", "0"]] },
  ...(quick ? [] : [{ name: "build", group: "Code", run: ["node", ["scripts/run-framework.mjs", "build"]], slow: true }]),
];

if (import.meta.url === `file://${process.argv[1]}`) {
  const before = fingerprint();
  const started = Date.now();
  const failed = [];
  for (const step of steps) {
    const at = Date.now();
    const result = spawnSync(step.run[0], step.run[1], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: step.slow ? 600_000 : 240_000 });
    const ok = result.status === 0;
    console.log(`${ok ? "pass" : "FAIL"}  ${step.group} · ${step.name}  ${((Date.now() - at) / 1000).toFixed(1)}s`);
    if (!ok) {
      const tail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim().split("\n").slice(-12).join("\n");
      failed.push({ step: `${step.group} · ${step.name}`, tail });
      console.log(tail.replace(/^/gmu, "      "));
    }
  }
  // The code must be the same at the end as at the start, or the result says nothing about it.
  const after = fingerprint();
  const passed = failed.length === 0 && before === after;
  const result = { passed, quick, steps: steps.length, failed: failed.map((item) => item.step), fingerprint: after, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) };
  writeFileSync(join(root, ".vox-regression.json"), JSON.stringify(result, null, 2));
  console.log(passed ? `\nAll ${steps.length} checks passed in ${result.seconds}s.` : before !== after ? "\nThe code changed while the checks ran: run them again." : `\n${failed.length} of ${steps.length} checks failed: ${result.failed.join(", ")}.`);
  process.exit(passed ? 0 : 1);
}
