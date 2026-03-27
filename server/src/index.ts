import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadGameConfig } from "./config/loadGameConfig.js";
import { verifyNeo4jConnectivity } from "./neo4j/driver.js";
import {
  getBondBetweenPets,
  getCounterMultiplier,
  getPlayerPets,
} from "./neo4j/queries.js";
import { verifyPostgresConnectivity } from "./postgres/driver.js";
import { parseRegisterIdentity } from "./auth/validators.js";
import { hashPassword, verifyPassword } from "./auth/password.js";
import { createUser, findUserByIdentity } from "./postgres/users.js";
import {
  createSession,
  deleteSessionByToken,
  findSessionUserByToken,
  pruneExpiredSessions,
} from "./auth/sessions.js";

const app = new Hono();

app.get("/health", async (c) => {
  let gameTitle = "unknown";
  try {
    const cfg = await loadGameConfig();
    gameTitle = cfg.gameTitle;
  } catch {
    gameTitle = "config_load_failed";
  }
  const neo4j = await verifyNeo4jConnectivity();
  const postgres = await verifyPostgresConnectivity();
  return c.json({
    ok: true,
    service: "smartpet-duel-server",
    gameTitle,
    neo4j,
    postgres,
  });
});

app.post("/auth/register", async (c) => {
  const body = await c.req.json<{
    account?: string;
    password?: string;
    nickname?: string;
  }>();

  const account = (body.account ?? "").trim();
  const password = body.password ?? "";
  const nickname = body.nickname?.trim() || null;

  if (!account) {
    return c.json({ ok: false, error: "account_required" }, 400);
  }
  if (password.length < 6) {
    return c.json({ ok: false, error: "password_too_short" }, 400);
  }

  const identity = parseRegisterIdentity(account);
  if (!identity) {
    return c.json({ ok: false, error: "invalid_email_or_phone_format" }, 400);
  }

  const passwordHash = await hashPassword(password);
  const created = await createUser({
    registerType: identity.registerType,
    email: identity.email,
    phone: identity.phone,
    passwordHash,
    nickname,
  });

  if (!created.ok) {
    return c.json({ ok: false, error: created.reason }, 409);
  }

  return c.json({ ok: true, user: created.user }, 201);
});

app.post("/auth/login", async (c) => {
  const body = await c.req.json<{ account?: string; password?: string }>();
  const account = (body.account ?? "").trim();
  const password = body.password ?? "";

  if (!account) {
    return c.json({ ok: false, error: "account_required" }, 400);
  }
  if (!password) {
    return c.json({ ok: false, error: "password_required" }, 400);
  }

  const identity = parseRegisterIdentity(account);
  if (!identity) {
    return c.json({ ok: false, error: "invalid_email_or_phone_format" }, 400);
  }

  const user = await findUserByIdentity(
    identity.registerType === "email"
      ? { registerType: "email", email: identity.email }
      : { registerType: "phone", phone: identity.phone },
  );
  if (!user) {
    return c.json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const passed = await verifyPassword(password, user.passwordHash);
  if (!passed) {
    return c.json({ ok: false, error: "invalid_credentials" }, 401);
  }

  await pruneExpiredSessions();
  const sessionToken = await createSession(user.id);

  return c.json({
    ok: true,
    sessionToken,
    user: {
      id: user.id,
      registerType: user.registerType,
      email: user.email,
      phone: user.phone,
      nickname: user.nickname,
      createdAt: user.createdAt,
    },
  });
});

app.get("/auth/me", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return c.json({ ok: false, error: "missing_or_invalid_authorization" }, 401);
  }

  const user = await findSessionUserByToken(token);
  if (!user) {
    return c.json({ ok: false, error: "invalid_or_expired_session" }, 401);
  }

  return c.json({ ok: true, user });
});

app.post("/auth/logout", async (c) => {
  const authHeader = c.req.header("authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return c.json({ ok: false, error: "missing_or_invalid_authorization" }, 401);
  }

  const deleted = await deleteSessionByToken(token);
  if (!deleted) {
    return c.json({ ok: false, error: "invalid_or_expired_session" }, 401);
  }

  return c.json({ ok: true });
});

app.get("/graph/player/:playerId/pets", async (c) => {
  const playerId = c.req.param("playerId");
  const pets = await getPlayerPets(playerId);
  return c.json({ playerId, pets });
});

app.get("/graph/bond/:petAId/:petBId", async (c) => {
  const petAId = c.req.param("petAId");
  const petBId = c.req.param("petBId");
  const bond = await getBondBetweenPets(petAId, petBId);
  return c.json({ petAId, petBId, bond });
});

app.get("/graph/counter/:attacker/:defender", async (c) => {
  const attacker = c.req.param("attacker");
  const defender = c.req.param("defender");
  const multiplier = await getCounterMultiplier(attacker, defender);
  return c.json({ attacker, defender, multiplier });
});

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] http://localhost:${info.port}  (health: /health)`);
});
