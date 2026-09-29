import "server-only";
import pg from "pg";

let pool: pg.Pool | undefined;
export function executionPool(): pg.Pool {
  if (!process.env.DATABASE_URL) throw new Error("EXECUTION_DATABASE_UNAVAILABLE");
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
  return pool;
}
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await executionPool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
