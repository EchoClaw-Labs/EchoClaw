/**
 * Postgres connection pool + typed query helpers.
 *
 * Uses pg (node-postgres) with prepared statements for fastest reads.
 * Pool is singleton per process.
 */

import pg from "pg";
import logger from "../../utils/logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.AGENT_DB_URL ?? "postgresql://echo_agent:echo_agent@localhost:5432/echo_agent";
    pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    pool.on("error", (err) => {
      logger.error(`[agent-db] pool error: ${err.message}`);
    });
  }
  return pool;
}

/** Run a query and return all rows typed as T. */
export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

/** Run a query and return the first row, or null. */
export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0] ?? null;
}

/** Run a mutation and return affected row count. */
export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const result = await getPool().query(sql, params);
  return result.rowCount ?? 0;
}

/** Graceful shutdown — drain the pool. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("[agent-db] pool closed");
  }
}
