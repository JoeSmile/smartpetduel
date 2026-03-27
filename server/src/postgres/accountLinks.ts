import { randomUUID } from "node:crypto";
import { getPostgresPool } from "./driver.js";

export type ChannelProvider = "openclaw" | "doubao";

export type CreateAccountLinkResult =
  | { ok: true; link: { provider: ChannelProvider; externalUserId: string; localUserId: string; createdAt: string } }
  | { ok: false; reason: "already_linked" | "provider_already_bound_to_user" };

export async function createAccountLink(input: {
  provider: ChannelProvider;
  externalUserId: string;
  localUserId: string;
}): Promise<CreateAccountLinkResult> {
  const pool = getPostgresPool();
  try {
    const res = await pool.query(
      `
      INSERT INTO user_account_links (id, provider, external_user_id, local_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING provider, external_user_id, local_user_id, created_at
      `,
      [randomUUID(), input.provider, input.externalUserId, input.localUserId],
    );
    const row = res.rows[0];
    return {
      ok: true,
      link: {
        provider: row.provider as ChannelProvider,
        externalUserId: row.external_user_id as string,
        localUserId: row.local_user_id as string,
        createdAt: String(row.created_at),
      },
    };
  } catch (err: unknown) {
    const pgErr = err as { code?: string; detail?: string };
    if (pgErr.code === "23505") {
      if (pgErr.detail?.includes("(provider, external_user_id)")) {
        return { ok: false, reason: "already_linked" };
      }
      return { ok: false, reason: "provider_already_bound_to_user" };
    }
    throw err;
  }
}

export async function findLocalUserIdByExternal(
  provider: ChannelProvider,
  externalUserId: string,
): Promise<string | null> {
  const pool = getPostgresPool();
  const res = await pool.query(
    `
    SELECT local_user_id
    FROM user_account_links
    WHERE provider = $1 AND external_user_id = $2
    LIMIT 1
    `,
    [provider, externalUserId],
  );
  if (!res.rows.length) return null;
  return res.rows[0].local_user_id as string;
}

