import { getPostgresPool } from "./driver.js";

export async function applyPostgresSchema(): Promise<void> {
  const pool = getPostgresPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      register_type TEXT NOT NULL CHECK (register_type IN ('email','phone')),
      email TEXT UNIQUE,
      phone TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT users_identity_present CHECK (
        (register_type = 'email' AND email IS NOT NULL AND phone IS NULL) OR
        (register_type = 'phone' AND phone IS NOT NULL AND email IS NULL)
      )
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      token TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions(expires_at);
  `);
}
