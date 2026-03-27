import { randomBytes } from "node:crypto";
import { getPostgresPool } from "../postgres/driver.js";

const SESSION_TTL_DAYS = 7;

export type SessionUser = {
  id: string;
  registerType: "email" | "phone";
  email: string | null;
  phone: string | null;
  nickname: string | null;
  createdAt: string;
};

export async function createSession(userId: string): Promise<string> {
  const pool = getPostgresPool();
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `
    INSERT INTO user_sessions (token, user_id, expires_at)
    VALUES ($1, $2, NOW() + INTERVAL '${SESSION_TTL_DAYS} days')
    `,
    [token, userId],
  );
  return token;
}

export async function findSessionUserByToken(
  token: string,
): Promise<SessionUser | null> {
  const pool = getPostgresPool();
  const res = await pool.query(
    `
    SELECT u.id, u.register_type, u.email, u.phone, u.nickname, u.created_at
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = $1 AND s.expires_at > NOW()
    LIMIT 1
    `,
    [token],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    id: row.id as string,
    registerType: row.register_type as "email" | "phone",
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export async function pruneExpiredSessions(): Promise<void> {
  const pool = getPostgresPool();
  await pool.query(`DELETE FROM user_sessions WHERE expires_at <= NOW()`);
}

export async function deleteSessionByToken(token: string): Promise<boolean> {
  const pool = getPostgresPool();
  const res = await pool.query(`DELETE FROM user_sessions WHERE token = $1`, [
    token,
  ]);
  return (res.rowCount ?? 0) > 0;
}
