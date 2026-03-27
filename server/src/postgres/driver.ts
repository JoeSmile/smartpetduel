import { Pool } from "pg";
import { getPostgresConfig } from "../env.js";

let pool: Pool | null = null;

export function getPostgresPool(): Pool {
  if (!pool) {
    const cfg = getPostgresConfig();
    pool = new Pool({
      host: cfg.host,
      port: cfg.port,
      database: cfg.database,
      user: cfg.user,
      password: cfg.password,
      ssl: cfg.ssl ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }
  return pool;
}

export async function verifyPostgresConnectivity(): Promise<
  "ok" | "error"
> {
  try {
    const p = getPostgresPool();
    await p.query("SELECT 1");
    return "ok";
  } catch {
    return "error";
  }
}

export async function closePostgresPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
