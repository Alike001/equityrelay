import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sql = readFileSync(join(root, "db/migrations/001_execution.sql"), "utf8");
const db = new PGlite();
try {
  await db.exec(sql);
  const result = await db.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public'");
  if (result.rows[0]?.count !== 7) throw new Error("EXPECTED_SEVEN_EXECUTION_TABLES");
  console.log("PostgreSQL migration applied; seven required tables exist.");
} finally { await db.close(); }
