import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { loadGameConfig } from "../config/loadGameConfig.js";
import { parseRegisterIdentity } from "../auth/validators.js";
import { hashPassword } from "../auth/password.js";
import {
  createUser,
  findUserByIdentity,
  findUserById,
} from "../postgres/users.js";
import {
  createSession,
  findSessionUserByToken,
  pruneExpiredSessions,
} from "../auth/sessions.js";
import { hitRateLimit } from "../auth/rateLimit.js";
import { type BattleAction, type BattleState } from "../game/engine.js";
import { listLegalActions } from "../ai/battle/legalActions.js";
import { decideBattleAiAction } from "../ai/battle/langgraphAgent.js";
import { getPlayerPets } from "../neo4j/queries.js";
import {
  createBattleSession,
  createPvpLobbySession,
  getBattleSession,
  kickAiIfNeeded,
  resetPvpSessionToLobby,
  setPvpLineup,
  setPvpReady,
  startPvpBattle,
  submitBattleAction,
} from "../battle/sessionService.js";
import {
  inferBattleMode,
  type ClientChannel,
  type SideController,
} from "../battle/sessionModel.js";

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

function resolveAuth(c: {
  req: { header: (k: string) => string | undefined };
}): AuthResolved {
  const bearer = readBearerToken(c.req.header("authorization"));
  if (bearer.ok) return { ok: true, token: bearer.token, via: "bearer" };
  const cookieToken = getCookie(c as never, "sp_session");
  if (cookieToken) return { ok: true, token: cookieToken, via: "cookie" };
  return { ok: false };
}

async function optionalSessionUser(c: {
  req: { header: (k: string) => string | undefined };
}): Promise<Awaited<ReturnType<typeof findSessionUserByToken>>> {
  const parsed = resolveAuth(c);
  if (!parsed.ok) return null;
  return findSessionUserByToken(parsed.token);
}

function getClientIp(c: {
  req: { header: (k: string) => string | undefined };
}): string {
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

const SKILL_DISCOVERY = {
  ok: true as const,
  version: "1",
  basePath: "/skill/v1",
  auth:
    "Authorization: Bearer <sessionToken> from POST /skill/v1/auth/login (cookie session also accepted)",
  endpoints: [
    { method: "GET", path: "/skill/v1", note: "this discovery document" },
    { method: "GET", path: "/skill/v1/me", note: "current user" },
    { method: "POST", path: "/skill/v1/auth/login", note: "passwordless signup+login" },
    { method: "POST", path: "/skill/v1/battle/session/create", note: "PVE/PvP lobby" },
    { method: "GET", path: "/skill/v1/battle/session/:sessionId", note: "poll session" },
    {
      method: "PATCH",
      path: "/skill/v1/battle/session/:sessionId/lineup",
      note: "PvP lineup",
    },
    {
      method: "POST",
      path: "/skill/v1/battle/session/:sessionId/ready",
      note: "PvP ready",
    },
    {
      method: "POST",
      path: "/skill/v1/battle/session/:sessionId/start",
      note: "PvP start",
    },
    {
      method: "POST",
      path: "/skill/v1/battle/session/:sessionId/rematch",
      note: "PvP rematch",
    },
    { method: "POST", path: "/skill/v1/battle/session/submit", note: "submit action" },
    { method: "POST", path: "/skill/v1/ai/battle/legal-actions", note: "legal moves" },
    { method: "POST", path: "/skill/v1/ai/battle/next-action", note: "AI suggestion" },
    {
      method: "GET",
      path: "/skill/v1/game/catalog",
      note: "pets, skills, comboSkills, attributes, counters, battleRules",
    },
    { method: "GET", path: "/skill/v1/game/unlock-links", note: "unlock links" },
    {
      method: "GET",
      path: "/skill/v1/graph/player/:playerId/pets",
      note: "Neo4j player pets",
    },
  ],
};

export function createSkillApp(): Hono {
  const skill = new Hono();

  skill.get("/", (c) => c.json(SKILL_DISCOVERY));

  skill.get("/me", async (c) => {
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

  skill.post("/auth/login", async (c) => {
    const body = await c.req.json<{ account?: string; password?: string }>();
    const account = (body.account ?? "").trim();
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
    const identity = parseRegisterIdentity(account);
    if (!identity) {
      return c.json({ ok: false, error: "invalid_email_or_phone_format" }, 400);
    }
    const identityQuery =
      identity.registerType === "email"
        ? { registerType: "email" as const, email: identity.email }
        : { registerType: "phone" as const, phone: identity.phone };

    let user = await findUserByIdentity(identityQuery);
    if (!user) {
      const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
      const created = await createUser({
        registerType: identity.registerType,
        email: identity.registerType === "email" ? identity.email : null,
        phone: identity.registerType === "phone" ? identity.phone : null,
        passwordHash,
        nickname: null,
      });
      if (created.ok) {
        user = await findUserById(created.user.id);
      } else if (created.reason === "identifier_exists") {
        user = await findUserByIdentity(identityQuery);
      } else {
        return c.json({ ok: false, error: "account_create_failed" }, 500);
      }
    }
    if (!user) {
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

  skill.post("/ai/battle/legal-actions", async (c) => {
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

  skill.post("/ai/battle/next-action", async (c) => {
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

  skill.post("/battle/session/create", async (c) => {
    const user = await optionalSessionUser(c);
    const body = await c.req.json<{
      teamA?: [string, string, string];
      teamB?: [string, string, string];
      controllers?: { A?: SideController; B?: SideController };
      seed?: string;
      ttlSec?: number;
      humanTurnTimeoutSec?: number;
      clientChannel?: ClientChannel;
    }>();
    if (!body.controllers?.A || !body.controllers?.B) {
      return c.json({ ok: false, error: "controllers_required" }, 400);
    }
    const chRaw = (c.req.header("x-client-channel") ?? "").toLowerCase();
    const clientChannel: ClientChannel =
      body.clientChannel ??
      (chRaw === "openclaw" || chRaw === "doubao" || chRaw === "web"
        ? chRaw
        : "web");

    const controllers: { A: SideController; B: SideController } = {
      A: { ...body.controllers.A },
      B: { ...body.controllers.B },
    };
    const mode = inferBattleMode(controllers);
    if (mode === "pvp") {
      if (!user) {
        return c.json({ ok: false, error: "pvp_login_required" }, 401);
      }
      const ua = controllers.A.kind === "human" ? controllers.A.userId : null;
      const ub = controllers.B.kind === "human" ? controllers.B.userId : null;
      if (!ua || !ub || ua === ub) {
        return c.json({ ok: false, error: "pvp_distinct_user_ids_required" }, 400);
      }
      if (user.id !== ua && user.id !== ub) {
        return c.json({ ok: false, error: "pvp_creator_not_participant" }, 403);
      }
      try {
        const [rowA, rowB] = await Promise.all([findUserById(ua), findUserById(ub)]);
        if (!rowA || !rowB) {
          return c.json({ ok: false, error: "pvp_user_not_found" }, 404);
        }
      } catch (err) {
        console.error("[battle] pvp user lookup", err);
        return c.json({ ok: false, error: "pvp_user_lookup_failed" }, 503);
      }
      controllers.A = { kind: "human", userId: ua };
      controllers.B = { kind: "human", userId: ub };

      const config = await loadGameConfig();
      const session = createPvpLobbySession({
        config,
        controllers,
        ttlSec: body.ttlSec,
        humanTurnTimeoutSec: body.humanTurnTimeoutSec,
        clientChannel,
      });
      const latest = await getBattleSession(session.sessionId);
      return c.json({ ok: true, session: latest ?? session });
    }

    if (!body.teamA || !body.teamB) {
      return c.json({ ok: false, error: "team_and_controllers_required" }, 400);
    }

    for (const side of ["A", "B"] as const) {
      const ctrl = controllers[side];
      if (ctrl.kind === "human") {
        if (user) {
          if (ctrl.userId && ctrl.userId !== user.id) {
            return c.json({ ok: false, error: "human_user_mismatch" }, 403);
          }
          controllers[side] = { ...ctrl, userId: user.id };
        }
      }
    }

    const config = await loadGameConfig();
    const session = createBattleSession({
      config,
      teamA: body.teamA,
      teamB: body.teamB,
      controllers,
      seed: body.seed,
      ttlSec: body.ttlSec,
      humanTurnTimeoutSec: body.humanTurnTimeoutSec,
      clientChannel,
    });
    await kickAiIfNeeded({ config, sessionId: session.sessionId });
    const latest = await getBattleSession(session.sessionId);
    return c.json({ ok: true, session: latest ?? session });
  });

  skill.patch("/battle/session/:sessionId/lineup", async (c) => {
    const user = await optionalSessionUser(c);
    if (!user) {
      return c.json({ ok: false, error: "pvp_login_required" }, 401);
    }
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{
      side?: "A" | "B";
      team?: [string, string, string];
      expectedStateVersion?: number;
    }>();
    if (
      (body.side !== "A" && body.side !== "B") ||
      !body.team ||
      typeof body.expectedStateVersion !== "number"
    ) {
      return c.json({ ok: false, error: "invalid_lineup_payload" }, 400);
    }
    const config = await loadGameConfig();
    const result = await setPvpLineup({
      config,
      sessionId,
      side: body.side,
      team: body.team,
      userId: user.id,
      expectedStateVersion: body.expectedStateVersion,
    });
    if (!result.ok) {
      const status =
        result.code === "forbidden"
          ? 403
          : result.code === "version_conflict"
            ? 409
            : result.code === "invalid_team"
              ? 400
              : 404;
      return c.json({ ok: false, error: result.code }, status as 400 | 403 | 404 | 409);
    }
    const latest = await getBattleSession(sessionId);
    return c.json({ ok: true, session: latest ?? result.session });
  });

  skill.post("/battle/session/:sessionId/ready", async (c) => {
    const user = await optionalSessionUser(c);
    if (!user) {
      return c.json({ ok: false, error: "pvp_login_required" }, 401);
    }
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{
      side?: "A" | "B";
      expectedStateVersion?: number;
    }>();
    if (
      (body.side !== "A" && body.side !== "B") ||
      typeof body.expectedStateVersion !== "number"
    ) {
      return c.json({ ok: false, error: "invalid_ready_payload" }, 400);
    }
    const config = await loadGameConfig();
    const result = await setPvpReady({
      config,
      sessionId,
      side: body.side,
      userId: user.id,
      expectedStateVersion: body.expectedStateVersion,
    });
    if (!result.ok) {
      const status =
        result.code === "forbidden"
          ? 403
          : result.code === "version_conflict"
            ? 409
            : result.code === "lineup_required"
              ? 400
              : 404;
      return c.json({ ok: false, error: result.code }, status as 400 | 403 | 404 | 409);
    }
    const latest = await getBattleSession(sessionId);
    return c.json({ ok: true, session: latest ?? result.session });
  });

  skill.post("/battle/session/:sessionId/start", async (c) => {
    const user = await optionalSessionUser(c);
    if (!user) {
      return c.json({ ok: false, error: "pvp_login_required" }, 401);
    }
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ expectedStateVersion?: number }>();
    if (typeof body.expectedStateVersion !== "number") {
      return c.json({ ok: false, error: "invalid_start_payload" }, 400);
    }
    const config = await loadGameConfig();
    const result = await startPvpBattle({
      config,
      sessionId,
      userId: user.id,
      expectedStateVersion: body.expectedStateVersion,
    });
    if (!result.ok) {
      const status =
        result.code === "forbidden"
          ? 403
          : result.code === "version_conflict"
            ? 409
            : result.code === "not_ready" || result.code === "lineup_incomplete"
              ? 400
              : 404;
      return c.json({ ok: false, error: result.code }, status as 400 | 403 | 404 | 409);
    }
    await kickAiIfNeeded({ config, sessionId });
    const latest = await getBattleSession(sessionId);
    return c.json({ ok: true, session: latest ?? result.session });
  });

  skill.post("/battle/session/:sessionId/rematch", async (c) => {
    const user = await optionalSessionUser(c);
    if (!user) {
      return c.json({ ok: false, error: "pvp_login_required" }, 401);
    }
    const sessionId = c.req.param("sessionId");
    const body = await c.req.json<{ expectedStateVersion?: number }>();
    if (typeof body.expectedStateVersion !== "number") {
      return c.json({ ok: false, error: "invalid_rematch_payload" }, 400);
    }
    const result = await resetPvpSessionToLobby({
      sessionId,
      userId: user.id,
      expectedStateVersion: body.expectedStateVersion,
    });
    if (!result.ok) {
      const status =
        result.code === "forbidden"
          ? 403
          : result.code === "version_conflict"
            ? 409
            : result.code === "not_battle_ended"
              ? 400
              : 404;
      return c.json({ ok: false, error: result.code }, status as 400 | 403 | 404 | 409);
    }
    const latest = await getBattleSession(sessionId);
    return c.json({ ok: true, session: latest ?? result.session });
  });

  skill.get("/battle/session/:sessionId", async (c) => {
    const config = await loadGameConfig();
    const sessionId = c.req.param("sessionId");
    const touched = await kickAiIfNeeded({ config, sessionId });
    if (!touched) {
      return c.json({ ok: false, error: "session_not_found_or_expired" }, 404);
    }
    return c.json({ ok: true, session: touched });
  });

  skill.post("/battle/session/submit", async (c) => {
    const user = await optionalSessionUser(c);
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
    if (user && body.userId && body.userId !== user.id) {
      return c.json({ ok: false, error: "user_id_mismatch" }, 403);
    }
    const effectiveUserId = user?.id ?? body.userId;
    if (!effectiveUserId) {
      return c.json({ ok: false, error: "user_id_required" }, 400);
    }
    const config = await loadGameConfig();
    const result = await submitBattleAction({
      config,
      sessionId: body.sessionId,
      side: body.side,
      action: body.action,
      expectedStateVersion: body.expectedStateVersion,
      userId: effectiveUserId,
    });
    if (!result.ok) {
      const status =
        result.code === "forbidden"
          ? 403
          : result.code === "finished" ||
              result.code === "version_conflict" ||
              result.code === "lobby_not_started"
            ? 409
            : 404;
      return c.json({ ok: false, error: result.code }, status as 403 | 404 | 409);
    }
    return c.json({ ok: true, session: result.session });
  });

  skill.get("/game/unlock-links", async (c) => {
    const config = await loadGameConfig();
    return c.json({ ok: true, unlockLinks: config.unlockLinks });
  });

  skill.get("/game/catalog", async (c) => {
    const config = await loadGameConfig();
    return c.json({
      ok: true,
      version: config.version,
      gameTitle: config.gameTitle,
      pets: config.pets,
      skills: config.skills,
      comboSkills: config.comboSkills,
      attributes: config.attributes,
      counters: config.counters,
      battleRules: config.battleRules,
    });
  });

  skill.get("/graph/player/:playerId/pets", async (c) => {
    const playerId = c.req.param("playerId");
    const pets = await getPlayerPets(playerId);
    return c.json({ playerId, pets });
  });

  return skill;
}
