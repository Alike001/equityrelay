import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

if (!process.env.DATABASE_URL) throw new Error("EXECUTION_DATABASE_UNAVAILABLE");
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const name of readdirSync(join(root, "db/migrations")).filter(x => /^\d+_.+\.sql$/.test(x)).sort()) {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('equityrelay:migrations'))");
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [name]);
      if (!existing.rowCount) {
        const sql = readFileSync(join(root, "db/migrations", name), "utf8")
          .replace(/^BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
      }
      await client.query("COMMIT");
      process.stdout.write(`${name}: ${existing.rowCount ? "already applied" : "applied"}\n`);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} finally { await client.end(); }
