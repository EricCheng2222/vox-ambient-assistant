import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

// Just enough of Cloudflare D1 for the Worker's queries, backed by an
// in-memory SQLite database with this site's migrations applied.
export function createD1(migrationsDir) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
  }
  const values = (params) => params.map((value) => (value === undefined ? null : value));
  class Statement {
    constructor(sql, params = []) {
      this.sql = sql;
      this.params = params;
    }
    bind(...params) {
      return new Statement(this.sql, params);
    }
    async first() {
      const row = sqlite.prepare(this.sql).get(...values(this.params));
      return row ? { ...row } : null;
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...values(this.params)).map((row) => ({ ...row })) };
    }
    async run() {
      const info = sqlite.prepare(this.sql).run(...values(this.params));
      return { success: true, meta: { changes: Number(info.changes) } };
    }
  }
  return {
    sqlite,
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
