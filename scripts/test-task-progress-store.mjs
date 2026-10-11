import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/d1";
import ts from "typescript";

// Exercise production queries against SQLite through the same D1 driver.
// Only the Worker environment's database binding is substituted.
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE remote_commands (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, device_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL, iv TEXT NOT NULL, status TEXT NOT NULL,
  result_ciphertext TEXT, result_iv TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL, completed_at TEXT
)`);
const database = drizzle({ prepare(sql) {
  return { bind(...params) {
    const statement = sqlite.prepare(sql);
    return {
      async run() { return { meta: { changes: Number(statement.run(...params).changes) } }; },
      async all() { return { results: statement.all(...params) }; },
      async raw() { statement.setReturnArrays(true); return statement.all(...params); },
    };
  } };
} });
const key = `__voxTaskProgressDb_${randomUUID().replaceAll("-", "")}`;
globalThis[key] = database;
try {
  const source = (await readFile(new URL("../lib/remote-device-store.ts", import.meta.url), "utf8"))
    .replace('import { getDb } from "@/db";', `const getDb = () => globalThis[${JSON.stringify(key)}];`)
    .replace('from "@/db/schema"', `from ${JSON.stringify(new URL("../db/schema.ts", import.meta.url).href)}`)
    .replace('from "drizzle-orm"', `from ${JSON.stringify(import.meta.resolve("drizzle-orm"))}`);
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText;
  const { updateRemoteTaskProgress, completeRemoteCommand, startRemoteCommand } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const id = randomUUID();
  const deviceId = randomUUID();
  const owner = "test-owner";
  const expiry = new Date(Date.now() + 60_000).toISOString();
  sqlite.prepare("INSERT INTO remote_commands (id,owner_id,device_id,ciphertext,iv,status,expires_at) VALUES (?,?,?,?,?,'pending',?)").run(id, owner, deviceId, "command", "iv", expiry);
  const progress = { id, deviceId, resultCiphertext: "encrypted-progress", resultIv: "progress-iv" };
  const row = () => ({ ...sqlite.prepare("SELECT * FROM remote_commands WHERE id = ?").get(id) });
  assert.equal(await updateRemoteTaskProgress(owner, progress), false, "pending commands cannot report progress");
  assert.equal(await startRemoteCommand(owner, { id, deviceId }), true);
  const started = row();
  assert.equal(await updateRemoteTaskProgress("another-owner", progress), false);
  assert.equal(await updateRemoteTaskProgress(owner, { ...progress, deviceId: randomUUID() }), false);
  assert.equal(await updateRemoteTaskProgress(owner, { ...progress, id: randomUUID() }), false);
  assert.equal(await updateRemoteTaskProgress(owner, progress), true);
  assert.equal(row().status, "running");
  assert.equal(row().expires_at, started.expires_at, "progress does not extend task execution");
  assert.equal(row().result_ciphertext, "encrypted-progress");
  assert.equal(row().ciphertext, "command", "progress cannot alter the command");
  sqlite.prepare("UPDATE remote_commands SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), id);
  assert.equal(await updateRemoteTaskProgress(owner, { ...progress, resultCiphertext: "expired" }), false);
  assert.equal(row().result_ciphertext, "encrypted-progress");
  assert.equal(await completeRemoteCommand(owner, { ...progress, resultCiphertext: "encrypted-result" }), true);
  const completed = row();
  assert.equal(await updateRemoteTaskProgress(owner, progress), false, "late progress cannot overwrite a final result");
  assert.deepEqual(row(), completed);
  assert.equal(completed.status, "completed");
  assert.equal(completed.result_ciphertext, "encrypted-result");
} finally {
  delete globalThis[key];
  sqlite.close();
}
console.log("Encrypted task progress ownership, execution deadline, and final-result immutability checks passed.");
