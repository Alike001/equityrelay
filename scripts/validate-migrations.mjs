import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const db = new PGlite();
try {
  for (const file of ["001_execution.sql", "002_reservation_time.sql"]) {
    await db.exec(readFileSync(join(root, "db/migrations", file), "utf8"));
  }
  const result = await db.query("SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public'");
  if (result.rows[0]?.count !== 7) throw new Error("EXPECTED_SEVEN_EXECUTION_TABLES");
  console.log("PostgreSQL migration applied; seven required tables exist.");
} finally { await db.close(); }
