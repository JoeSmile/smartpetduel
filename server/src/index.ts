import "dotenv/config";
import { randomBytes } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
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
import {
  createUser,
  findUserByIdentity,
  findUserById,
} from "./postgres/users.js";
import {
  createSession,
  deleteSessionByToken,
  findSessionUserByToken,
  pruneExpiredSessions,
} from "./auth/sessions.js";
import { hitRateLimit } from "./auth/rateLimit.js";
import { verifyChannelSignature } from "./auth/channelSignature.js";
import {
  createAccountLink,
  findLocalUserIdByExternal,
  type ChannelProvider,
} from "./postgres/accountLinks.js";
import {
  chatWithActiveProvider,
  getAiProviderHealth,
} from "./ai/providers/index.js";
import {
  createBattleState,
  type BattleAction,
  type BattleState,
} from "./game/engine.js";
import { listLegalActions } from "./ai/battle/legalActions.js";
import { decideBattleAiAction } from "./ai/battle/langgraphAgent.js";
import {
  createBattleSession,
  getBattleSession,
  kickAiIfNeeded,
  submitBattleAction,
} from "./battle/sessionService.js";
import type { SideController } from "./battle/sessionModel.js";

const app = new Hono();

function readBearerToken(
  authHeader: string | undefined,
): { ok: true; token: string } | { ok: false } {
  const header = authHeader ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return { ok: false };
  return { ok: true, token };
}

type AuthResolved =
  | { ok: true; token: string; via: "bearer" | "cookie" }
  | { ok: false };

function resolveAuth(c: { req: { header: (k: string) => string | undefined } }): AuthResolved {
  const bearer = readBearerToken(c.req.header("authorization"));
  if (bearer.ok) return { ok: true, token: bearer.token, via: "bearer" };
  const cookieToken = getCookie(c as never, "sp_session");
  if (cookieToken) return { ok: true, token: cookieToken, via: "cookie" };
  return { ok: false };
}

function getClientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return c.req.header("x-real-ip") ?? "unknown";
}

function setAuthCookies(
  c: unknown,
  sessionToken: string,
  csrfToken: string,
): void {
  const maxAge = 60 * 60 * 24 * 7;
  setCookie(c as never, "sp_session", sessionToken, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
    maxAge,
  });
  setCookie(c as never, "sp_csrf", csrfToken, {
    path: "/",
    httpOnly: false,
    sameSite: "Lax",
    secure: false,
    maxAge,
  });
}

function assertCsrfForCookieAuth(c: {
  req: { header: (k: string) => string | undefined };
}): boolean {
  const csrfCookie = getCookie(c as never, "sp_csrf");
  const csrfHeader = c.req.header("x-csrf-token");
  return Boolean(csrfCookie && csrfHeader && csrfCookie === csrfHeader);
}

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
  const ai = await getAiProviderHealth();
  return c.json({
    ok: true,
    service: "smartpet-duel-server",
    gameTitle,
    neo4j,
    postgres,
    ai,
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
  const registerLimit = hitRateLimit(`register:${getClientIp(c)}`, {
    max: 20,
    windowMs: 60_000,
  });
  if (!registerLimit.allowed) {
    c.header("Retry-After", String(registerLimit.retryAfterSec));
    return c.json({ ok: false, error: "too_many_requests" }, 429);
  }

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
  const loginLimit = hitRateLimit(`login:${getClientIp(c)}:${account}`, {
    max: 10,
    windowMs: 60_000,
  });
  if (!loginLimit.allowed) {
    c.header("Retry-After", String(loginLimit.retryAfterSec));
    return c.json({ ok: false, error: "too_many_requests" }, 429);
  }

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
  const csrfToken = randomBytes(16).toString("hex");
  setAuthCookies(c, sessionToken, csrfToken);

  return c.json({
    ok: true,
    sessionToken,
    csrfToken,
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
  const parsed = resolveAuth(c);
  if (!parsed.ok) {
    return c.json({ ok: false, error: "missing_or_invalid_authorization" }, 401);
  }

  const user = await findSessionUserByToken(parsed.token);
  if (!user) {
    return c.json({ ok: false, error: "invalid_or_expired_session" }, 401);
  }

  return c.json({ ok: true, user });
});

app.post("/auth/logout", async (c) => {
  const parsed = resolveAuth(c);
  if (!parsed.ok) {
    return c.json({ ok: false, error: "missing_or_invalid_authorization" }, 401);
  }
  if (parsed.via === "cookie" && !assertCsrfForCookieAuth(c)) {
    return c.json({ ok: false, error: "csrf_validation_failed" }, 403);
  }

  const deleted = await deleteSessionByToken(parsed.token);
  if (!deleted) {
    return c.json({ ok: false, error: "invalid_or_expired_session" }, 401);
  }

  deleteCookie(c, "sp_session", { path: "/" });
  deleteCookie(c, "sp_csrf", { path: "/" });
  return c.json({ ok: true });
});

app.post("/auth/refresh", async (c) => {
  const parsed = resolveAuth(c);
  if (!parsed.ok) {
    return c.json({ ok: false, error: "missing_or_invalid_authorization" }, 401);
  }
  if (parsed.via === "cookie" && !assertCsrfForCookieAuth(c)) {
    return c.json({ ok: false, error: "csrf_validation_failed" }, 403);
  }

  const user = await findSessionUserByToken(parsed.token);
  if (!user) {
    return c.json({ ok: false, error: "invalid_or_expired_session" }, 401);
  }

  await deleteSessionByToken(parsed.token);
  await pruneExpiredSessions();
  const sessionToken = await createSession(user.id);
  const csrfToken = randomBytes(16).toString("hex");
  setAuthCookies(c, sessionToken, csrfToken);

  return c.json({ ok: true, sessionToken, csrfToken });
});

app.post("/auth/channel/link", async (c) => {
  const parsed = resolveAuth(c);
  if (!parsed.ok) {
    return c.json({ ok: false, error: "missing_or_invalid_authorization" }, 401);
  }
  if (parsed.via === "cookie" && !assertCsrfForCookieAuth(c)) {
    return c.json({ ok: false, error: "csrf_validation_failed" }, 403);
  }
  const currentUser = await findSessionUserByToken(parsed.token);
  if (!currentUser) {
    return c.json({ ok: false, error: "invalid_or_expired_session" }, 401);
  }

  const rawBody = await c.req.text();
  let body: {
    provider?: ChannelProvider;
    externalUserId?: string;
  };
  try {
    body = JSON.parse(rawBody) as {
      provider?: ChannelProvider;
      externalUserId?: string;
    };
  } catch {
    return c.json({ ok: false, error: "invalid_json_body" }, 400);
  }
  const provider = body.provider;
  const externalUserId = (body.externalUserId ?? "").trim();
  if (
    (provider !== "openclaw" && provider !== "doubao") ||
    !externalUserId
  ) {
    return c.json({ ok: false, error: "invalid_provider_or_external_user_id" }, 400);
  }
  const sign = verifyChannelSignature({
    provider,
    timestamp: c.req.header("x-channel-timestamp"),
    nonce: c.req.header("x-channel-nonce"),
    signature: c.req.header("x-channel-signature"),
    rawBody,
  });
  if (!sign.ok) {
    return c.json({ ok: false, error: sign.reason }, 401);
  }

  const created = await createAccountLink({
    provider,
    externalUserId,
    localUserId: currentUser.id,
  });
  if (!created.ok) {
    return c.json({ ok: false, error: created.reason }, 409);
  }
  return c.json({ ok: true, link: created.link });
});

app.post("/auth/channel/login", async (c) => {
  const rawBody = await c.req.text();
  let body: {
    provider?: ChannelProvider;
    externalUserId?: string;
  };
  try {
    body = JSON.parse(rawBody) as {
      provider?: ChannelProvider;
      externalUserId?: string;
    };
  } catch {
    return c.json({ ok: false, error: "invalid_json_body" }, 400);
  }
  const provider = body.provider;
  const externalUserId = (body.externalUserId ?? "").trim();
  if (
    (provider !== "openclaw" && provider !== "doubao") ||
    !externalUserId
  ) {
    return c.json({ ok: false, error: "invalid_provider_or_external_user_id" }, 400);
  }
  const sign = verifyChannelSignature({
    provider,
    timestamp: c.req.header("x-channel-timestamp"),
    nonce: c.req.header("x-channel-nonce"),
    signature: c.req.header("x-channel-signature"),
    rawBody,
  });
  if (!sign.ok) {
    return c.json({ ok: false, error: sign.reason }, 401);
  }

  const localUserId = await findLocalUserIdByExternal(provider, externalUserId);
  if (!localUserId) {
    return c.json({ ok: false, error: "link_not_found" }, 404);
  }

  const user = await findUserById(localUserId);
  if (!user) {
    return c.json({ ok: false, error: "local_user_not_found" }, 404);
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

app.get("/ai/provider/health", async (c) => {
  const ai = await getAiProviderHealth();
  return c.json({ ok: true, ai });
});

app.post("/ai/provider/chat", async (c) => {
  const body = await c.req.json<{
    messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    temperature?: number;
    maxTokens?: number;
  }>();
  const messages = body.messages ?? [];
  if (!messages.length) {
    return c.json({ ok: false, error: "messages_required" }, 400);
  }
  try {
    const result = await chatWithActiveProvider({
      messages,
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });
    return c.json({ ok: true, result });
  } catch (err) {
    return c.json(
      { ok: false, error: "provider_chat_failed", detail: String(err) },
      500,
    );
  }
});

app.post("/ai/battle/legal-actions", async (c) => {
  const body = await c.req.json<{
    state?: BattleState;
    side?: "A" | "B";
  }>();
  if (!body.state || (body.side !== "A" && body.side !== "B")) {
    return c.json({ ok: false, error: "state_and_side_required" }, 400);
  }
  const config = await loadGameConfig();
  const legal = listLegalActions({
    state: body.state,
    config,
    side: body.side,
  });
  return c.json({ ok: true, legalActions: legal });
});

app.post("/ai/battle/next-action", async (c) => {
  const body = await c.req.json<{
    state?: BattleState;
    side?: "A" | "B";
    difficulty?: "easy" | "medium" | "hard";
  }>();
  if (!body.state || (body.side !== "A" && body.side !== "B")) {
    return c.json({ ok: false, error: "state_and_side_required" }, 400);
  }
  const difficulty = body.difficulty ?? "medium";
  const config = await loadGameConfig();
  const result = await decideBattleAiAction({
    state: body.state,
    config,
    side: body.side,
    difficulty,
  });
  return c.json({ ok: true, ...result });
});

app.get("/ai/battle/demo-state", async (c) => {
  const config = await loadGameConfig();
  const state = createBattleState({
    config,
    seed: "demo-seed-001",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    bondLevelBySide: {
      A: { "PET_FIRE_01|PET_FIRE_02": 3 },
      B: { "PET_GRASS_01|PET_GRASS_02": 2 },
    },
    normalSkillCooldownById: {
      SKILL_FIRE_01_A: 1,
      SKILL_GRASS_01_A: 1,
    },
  });
  return c.json({ ok: true, state });
});

app.post("/battle/session/create", async (c) => {
  const body = await c.req.json<{
    teamA?: [string, string, string];
    teamB?: [string, string, string];
    controllers?: { A?: SideController; B?: SideController };
    seed?: string;
    ttlSec?: number;
  }>();
  if (
    !body.teamA ||
    !body.teamB ||
    !body.controllers?.A ||
    !body.controllers?.B
  ) {
    return c.json({ ok: false, error: "team_and_controllers_required" }, 400);
  }
  const config = await loadGameConfig();
  const session = createBattleSession({
    config,
    teamA: body.teamA,
    teamB: body.teamB,
    controllers: { A: body.controllers.A, B: body.controllers.B },
    seed: body.seed,
    ttlSec: body.ttlSec,
  });
  await kickAiIfNeeded({ config, sessionId: session.sessionId });
  const latest = await getBattleSession(session.sessionId);
  return c.json({ ok: true, session: latest ?? session });
});

app.get("/battle/session/:sessionId", async (c) => {
  const config = await loadGameConfig();
  const sessionId = c.req.param("sessionId");
  const touched = await kickAiIfNeeded({ config, sessionId });
  if (!touched) {
    return c.json({ ok: false, error: "session_not_found_or_expired" }, 404);
  }
  return c.json({ ok: true, session: touched });
});

app.post("/battle/session/submit", async (c) => {
  const body = await c.req.json<{
    sessionId?: string;
    side?: "A" | "B";
    action?: BattleAction;
    expectedStateVersion?: number;
    userId?: string;
  }>();
  if (
    !body.sessionId ||
    (body.side !== "A" && body.side !== "B") ||
    !body.action ||
    typeof body.expectedStateVersion !== "number"
  ) {
    return c.json({ ok: false, error: "invalid_submit_payload" }, 400);
  }
  const config = await loadGameConfig();
  const result = await submitBattleAction({
    config,
    sessionId: body.sessionId,
    side: body.side,
    action: body.action,
    expectedStateVersion: body.expectedStateVersion,
    userId: body.userId,
  });
  if (!result.ok) {
    const status =
      result.code === "forbidden"
        ? 403
        : result.code === "finished" || result.code === "version_conflict"
          ? 409
          : 404;
    return c.json({ ok: false, error: result.code }, status as 403 | 404 | 409);
  }
  return c.json({ ok: true, session: result.session });
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
