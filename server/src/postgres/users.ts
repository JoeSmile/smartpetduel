import { randomUUID } from "node:crypto";
import { getPostgresPool } from "./driver.js";

export type CreateUserInput = {
  registerType: "email" | "phone";
  email: string | null;
  phone: string | null;
  passwordHash: string;
  nickname?: string | null;
};

export type CreateUserResult =
  | { ok: true; user: { id: string; registerType: "email" | "phone"; email: string | null; phone: string | null; nickname: string | null; createdAt: string } }
  | { ok: false; reason: "identifier_exists" };

export type StoredUser = {
  id: string;
  registerType: "email" | "phone";
  email: string | null;
  phone: string | null;
  nickname: string | null;
  passwordHash: string;
  createdAt: string;
};

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const pool = getPostgresPool();
  const id = randomUUID();
  try {
    const res = await pool.query(
      `
      INSERT INTO users (id, register_type, email, phone, password_hash, nickname)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, register_type, email, phone, nickname, created_at
      `,
      [
        id,
        input.registerType,
        input.email,
        input.phone,
        input.passwordHash,
        input.nickname ?? null,
      ],
    );
    const row = res.rows[0];
    return {
      ok: true,
      user: {
        id: row.id as string,
        registerType: row.register_type as "email" | "phone",
        email: (row.email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        nickname: (row.nickname as string | null) ?? null,
        createdAt: String(row.created_at),
      },
    };
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      return { ok: false, reason: "identifier_exists" };
    }
    throw err;
  }
}

export async function findUserByIdentity(
  identity: { registerType: "email"; email: string } | { registerType: "phone"; phone: string },
): Promise<StoredUser | null> {
  const pool = getPostgresPool();
  const isEmail = identity.registerType === "email";
  const res = await pool.query(
    `
    SELECT id, register_type, email, phone, nickname, password_hash, created_at
    FROM users
    WHERE ${isEmail ? "email = $1" : "phone = $1"}
    LIMIT 1
    `,
    [isEmail ? identity.email : identity.phone],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    id: row.id as string,
    registerType: row.register_type as "email" | "phone",
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    passwordHash: row.password_hash as string,
    createdAt: String(row.created_at),
  };
}

export async function findUserById(userId: string): Promise<StoredUser | null> {
  const pool = getPostgresPool();
  const res = await pool.query(
    `
    SELECT id, register_type, email, phone, nickname, password_hash, created_at
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId],
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  return {
    id: row.id as string,
    registerType: row.register_type as "email" | "phone",
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    nickname: (row.nickname as string | null) ?? null,
    passwordHash: row.password_hash as string,
    createdAt: String(row.created_at),
  };
}
