import { randomUUID } from "node:crypto";
import type { GameConfigJson } from "../config/loadGameConfig.js";
import { getBattleHumanTurnConfig } from "../env.js";
import { resolveTurn, createBattleState, type BattleAction } from "../game/engine.js";
import { CURRENT_RULESET_ID } from "../game/ruleset.js";
import { persistBattleProgress } from "../game/progression.js";
import { applyPvpEloWithRetry } from "../neo4j/queries.js";
import {
  type BattleSession,
  type ClientChannel,
  type PlayerSide,
  type PvpLobbySnapshot,
  type SideController,
  assertSideControlledByUser,
  humanSides,
  inferBattleMode,
  shouldAutopilotHuman,
} from "./sessionModel.js";
import { decideBattleAiAction } from "../ai/battle/langgraphAgent.js";

const sessions = new Map<string, BattleSession>();
const sessionLocks = new Map<string, Promise<void>>();
const DEFAULT_TTL_SEC = 30 * 60;

function nowIso(): string {
  return new Date().toISOString();
}

function getOpponent(side: PlayerSide): PlayerSide {
  return side === "A" ? "B" : "A";
}

function ensureNotExpired(session: BattleSession): boolean {
  const expireAt = new Date(session.updatedAt).getTime() + session.ttlSec * 1000;
  return Date.now() <= expireAt;
}

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionLocks.get(sessionId) ?? Promise.resolve();
  let release: () => void = () => {};
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  sessionLocks.set(sessionId, prev.then(() => current));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (sessionLocks.get(sessionId) === current) {
      sessionLocks.delete(sessionId);
    }
  }
}

function validateLineupTeam(
  config: GameConfigJson,
  team: [string, string, string],
): boolean {
  const ids = new Set(config.pets.map((p) => p.id));
  if (new Set(team).size !== 3) return false;
  return team.every((id) => ids.has(id));
}

function randomTeamFromConfig(config: GameConfigJson): [string, string, string] {
  const ids = [...new Set(config.pets.map((p) => p.id))];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  if (ids.length < 3) {
    throw new Error("game catalog must contain at least 3 pets");
  }
  return [ids[0]!, ids[1]!, ids[2]!];
}

function canStartPvp(session: BattleSession, config: GameConfigJson): boolean {
  const lobby = session.lobby;
  if (!lobby || session.phase !== "lobby") return false;
  for (const side of ["A", "B"] as const) {
    const ctrl = session.controllers[side];
    const raw = side === "A" ? lobby.teamA : lobby.teamB;
    if (ctrl.kind === "human") {
      if (!raw || !validateLineupTeam(config, raw)) return false;
      const ready = side === "A" ? lobby.readyA : lobby.readyB;
      if (!ready) return false;
    }
  }
  return true;
}

async function resolveOneTurnIfReady(
  session: BattleSession,
  config: GameConfigJson,
): Promise<void> {
  if (!session.state) return;
  const actionA = session.pendingActions.A;
  const actionB = session.pendingActions.B;
  if (!actionA || !actionB) return;
  resolveTurn({
    state: session.state,
    config,
    actionA,
    actionB,
  });
  session.pendingActions = {};
  session.stateVersion += 1;
  session.updatedAt = nowIso();
  if (session.state.ended) {
    session.status = "finished";
  } else {
    session.status = "running";
  }
}

async function persistProgressIfBattleEnded(session: BattleSession): Promise<void> {
  if (!session.state || !session.state.ended || session.progressPersistedAt) return;
  try {
    const jobs: Array<Promise<"ok" | "skipped">> = [];
    if (session.controllers.A.kind === "human" && session.controllers.A.userId) {
      jobs.push(
        persistBattleProgress({
          playerId: session.controllers.A.userId,
          state: session.state,
          side: "A",
        }),
      );
    }
    if (session.controllers.B.kind === "human" && session.controllers.B.userId) {
      jobs.push(
        persistBattleProgress({
          playerId: session.controllers.B.userId,
          state: session.state,
          side: "B",
        }),
      );
    }
    if (jobs.length > 0) {
      await Promise.all(jobs);
    }
    if (session.mode === "pvp") {
      const ua = session.controllers.A.userId;
      const ub = session.controllers.B.userId;
      const w = session.state.winner;
      if (ua && ub && w) {
        try {
          await applyPvpEloWithRetry({
            winner: w,
            userIdA: ua,
            userIdB: ub,
          });
        } catch (eloErr) {
          console.error("[battle] elo update failed", eloErr);
        }
      }
    }
    session.progressPersistedAt = nowIso();
  } catch (err) {
    // Do not block battle result readback on graph sync failure.
    console.error("[battle] persist progress failed", err);
  }
}

async function fillAiActionIfNeeded(
  session: BattleSession,
  config: GameConfigJson,
  side: PlayerSide,
): Promise<void> {
  if (!session.state) return;
  if (session.pendingActions[side]) return;
  const ctrl = session.controllers[side];
  if (ctrl.kind !== "ai") return;
  const ai = await decideBattleAiAction({
    state: session.state,
    config,
    side,
    difficulty: ctrl.aiDifficulty ?? "medium",
  });
  if (!ai.action) return;
  session.pendingActions[side] = ai.action;
}

function touchAwaitingHumanClock(session: BattleSession): void {
  if (!session.state || session.state.ended || !shouldAutopilotHuman(session)) {
    session.awaitingHumanSince = null;
    return;
  }
  const [humanSide] = humanSides(session);
  if (session.pendingActions[humanSide]) {
    session.awaitingHumanSince = null;
    return;
  }
  session.awaitingHumanSince = nowIso();
}

async function applyHumanTurnTimeoutIfNeeded(
  session: BattleSession,
  config: GameConfigJson,
): Promise<boolean> {
  if (!session.state || session.state.ended || !shouldAutopilotHuman(session)) {
    session.awaitingHumanSince = null;
    return false;
  }
  if (!session.awaitingHumanSince) return false;
  const deadline =
    new Date(session.awaitingHumanSince).getTime() + session.humanTurnTimeoutSec * 1000;
  if (Date.now() < deadline) return false;

  const [humanSide] = humanSides(session);
  if (session.pendingActions[humanSide]) return false;

  const { autopilotDifficulty } = getBattleHumanTurnConfig();
  const ai = await decideBattleAiAction({
    state: session.state,
    config,
    side: humanSide,
    difficulty: autopilotDifficulty,
    forceRuleFallback: true,
  });
  if (!ai.action) return false;
  session.pendingActions[humanSide] = ai.action;
  session.lastAutopilot = { side: humanSide, at: nowIso() };
  session.awaitingHumanSince = null;

  await fillAiActionIfNeeded(session, config, getOpponent(humanSide));
  await resolveOneTurnIfReady(session, config);
  if (session.mode === "aivai" && !session.state.ended) {
    await autoRunAivai(session, config);
  }
  await persistProgressIfBattleEnded(session);
  touchAwaitingHumanClock(session);
  session.updatedAt = nowIso();
  return true;
}

async function autoRunAivai(session: BattleSession, config: GameConfigJson): Promise<void> {
  if (!session.state) return;
  // Safety cap for accidental infinite loops.
  for (let i = 0; i < 100 && !session.state.ended; i += 1) {
    await fillAiActionIfNeeded(session, config, "A");
    await fillAiActionIfNeeded(session, config, "B");
    await resolveOneTurnIfReady(session, config);
    if (!session.pendingActions.A && !session.pendingActions.B && !session.state.ended) {
      break;
    }
  }
}

export function createBattleSession(input: {
  config: GameConfigJson;
  teamA: [string, string, string];
  teamB: [string, string, string];
  controllers: Record<PlayerSide, SideController>;
  seed?: string;
  ttlSec?: number;
  humanTurnTimeoutSec?: number;
  clientChannel?: ClientChannel | null;
}): BattleSession {
  const defaults = getBattleHumanTurnConfig();
  const session: BattleSession = {
    sessionId: randomUUID(),
    mode: inferBattleMode(input.controllers),
    rulesetId: CURRENT_RULESET_ID,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    progressPersistedAt: null,
    stateVersion: 1,
    ttlSec: input.ttlSec ?? DEFAULT_TTL_SEC,
    status: "pending",
    controllers: input.controllers,
    pendingActions: {},
    phase: "battle",
    lobby: null,
    state: createBattleState({
      config: input.config,
      seed: input.seed ?? randomUUID(),
      teamA: input.teamA,
      teamB: input.teamB,
    }),
    humanTurnTimeoutSec: input.humanTurnTimeoutSec ?? defaults.humanTurnTimeoutSec,
    awaitingHumanSince: null,
    lastAutopilot: null,
    clientChannel: input.clientChannel ?? null,
  };
  sessions.set(session.sessionId, session);
  return session;
}

export function createPvpLobbySession(input: {
  config: GameConfigJson;
  controllers: Record<PlayerSide, SideController>;
  seed?: string;
  ttlSec?: number;
  humanTurnTimeoutSec?: number;
  clientChannel?: ClientChannel | null;
}): BattleSession {
  const defaults = getBattleHumanTurnConfig();
  const lobby: PvpLobbySnapshot = {
    teamA: null,
    teamB: null,
    readyA: false,
    readyB: false,
  };
  const session: BattleSession = {
    sessionId: randomUUID(),
    mode: "pvp",
    rulesetId: CURRENT_RULESET_ID,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    progressPersistedAt: null,
    stateVersion: 1,
    ttlSec: input.ttlSec ?? DEFAULT_TTL_SEC,
    status: "pending",
    controllers: input.controllers,
    pendingActions: {},
    phase: "lobby",
    lobby,
    state: null,
    humanTurnTimeoutSec: input.humanTurnTimeoutSec ?? defaults.humanTurnTimeoutSec,
    awaitingHumanSince: null,
    lastAutopilot: null,
    clientChannel: input.clientChannel ?? null,
  };
  sessions.set(session.sessionId, session);
  return session;
}

export async function getBattleSession(sessionId: string): Promise<BattleSession | null> {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (!ensureNotExpired(session)) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

export async function submitBattleAction(input: {
  config: GameConfigJson;
  sessionId: string;
  side: PlayerSide;
  action: BattleAction;
  expectedStateVersion: number;
  userId?: string;
}): Promise<
  | { ok: true; session: BattleSession }
  | {
      ok: false;
      code:
        | "not_found"
        | "expired"
        | "finished"
        | "forbidden"
        | "version_conflict"
        | "lobby_not_started";
    }
> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return { ok: false, code: "not_found" as const };
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return { ok: false, code: "expired" as const };
    }
    if (session.phase === "lobby" || !session.state) {
      return { ok: false, code: "lobby_not_started" as const };
    }
    if (session.status === "finished" || session.state.ended) {
      return { ok: false, code: "finished" as const };
    }
    if (session.stateVersion !== input.expectedStateVersion) {
      return { ok: false, code: "version_conflict" as const };
    }

    const ctrl = session.controllers[input.side];
    if (ctrl.kind === "human") {
      if (!input.userId) return { ok: false, code: "forbidden" as const };
      const allowed = assertSideControlledByUser({
        session,
        side: input.side,
        userId: input.userId,
      });
      if (!allowed) return { ok: false, code: "forbidden" as const };
    }

    session.pendingActions[input.side] = input.action;
    await fillAiActionIfNeeded(session, input.config, getOpponent(input.side));
    await resolveOneTurnIfReady(session, input.config);
    if (session.mode === "aivai" && !session.state.ended) {
      await autoRunAivai(session, input.config);
    }
    await persistProgressIfBattleEnded(session);
    touchAwaitingHumanClock(session);
    session.updatedAt = nowIso();
    return { ok: true, session };
  });
}

export async function kickAiIfNeeded(input: {
  config: GameConfigJson;
  sessionId: string;
}): Promise<BattleSession | null> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return null;
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return null;
    }
    if (session.phase === "lobby" || !session.state) {
      session.updatedAt = nowIso();
      return session;
    }
    if (session.state.ended) return session;
    if (shouldAutopilotHuman(session)) {
      const [hs] = humanSides(session);
      if (!session.pendingActions[hs] && !session.awaitingHumanSince) {
        session.awaitingHumanSince = nowIso();
      }
    }
    await applyHumanTurnTimeoutIfNeeded(session, input.config);
    await fillAiActionIfNeeded(session, input.config, "A");
    await fillAiActionIfNeeded(session, input.config, "B");
    await resolveOneTurnIfReady(session, input.config);
    if (session.mode === "aivai" && !session.state.ended) {
      await autoRunAivai(session, input.config);
    }
    await persistProgressIfBattleEnded(session);
    touchAwaitingHumanClock(session);
    session.updatedAt = nowIso();
    return session;
  });
}

export async function setPvpLineup(input: {
  config: GameConfigJson;
  sessionId: string;
  side: PlayerSide;
  team: [string, string, string];
  userId: string;
  expectedStateVersion: number;
}): Promise<
  | { ok: true; session: BattleSession }
  | {
      ok: false;
      code:
        | "not_found"
        | "expired"
        | "not_lobby"
        | "forbidden"
        | "invalid_team"
        | "version_conflict";
    }
> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return { ok: false, code: "not_found" as const };
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return { ok: false, code: "expired" as const };
    }
    if (session.phase !== "lobby" || !session.lobby) {
      return { ok: false, code: "not_lobby" as const };
    }
    if (session.stateVersion !== input.expectedStateVersion) {
      return { ok: false, code: "version_conflict" as const };
    }
    const ctrl = session.controllers[input.side];
    if (ctrl.kind !== "human") {
      return { ok: false, code: "forbidden" as const };
    }
    if (!assertSideControlledByUser({ session, side: input.side, userId: input.userId })) {
      return { ok: false, code: "forbidden" as const };
    }
    if (!validateLineupTeam(input.config, input.team)) {
      return { ok: false, code: "invalid_team" as const };
    }
    const lobby = { ...session.lobby };
    if (input.side === "A") {
      lobby.teamA = input.team;
      lobby.readyA = false;
    } else {
      lobby.teamB = input.team;
      lobby.readyB = false;
    }
    session.lobby = lobby;
    session.stateVersion += 1;
    session.updatedAt = nowIso();
    return { ok: true, session };
  });
}

export async function setPvpReady(input: {
  config: GameConfigJson;
  sessionId: string;
  side: PlayerSide;
  userId: string;
  expectedStateVersion: number;
}): Promise<
  | { ok: true; session: BattleSession }
  | {
      ok: false;
      code:
        | "not_found"
        | "expired"
        | "not_lobby"
        | "forbidden"
        | "version_conflict"
        | "lineup_required";
    }
> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return { ok: false, code: "not_found" as const };
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return { ok: false, code: "expired" as const };
    }
    if (session.phase !== "lobby" || !session.lobby) {
      return { ok: false, code: "not_lobby" as const };
    }
    if (session.stateVersion !== input.expectedStateVersion) {
      return { ok: false, code: "version_conflict" as const };
    }
    const ctrl = session.controllers[input.side];
    if (ctrl.kind !== "human") {
      return { ok: false, code: "forbidden" as const };
    }
    if (!assertSideControlledByUser({ session, side: input.side, userId: input.userId })) {
      return { ok: false, code: "forbidden" as const };
    }
    const currentTeam = input.side === "A" ? session.lobby.teamA : session.lobby.teamB;
    if (!currentTeam || !validateLineupTeam(input.config, currentTeam)) {
      return { ok: false, code: "lineup_required" as const };
    }
    const lobby = { ...session.lobby };
    if (input.side === "A") {
      lobby.readyA = true;
    } else {
      lobby.readyB = true;
    }
    session.lobby = lobby;
    session.stateVersion += 1;
    session.updatedAt = nowIso();
    return { ok: true, session };
  });
}

export async function startPvpBattle(input: {
  config: GameConfigJson;
  sessionId: string;
  userId: string;
  expectedStateVersion: number;
}): Promise<
  | { ok: true; session: BattleSession }
  | {
      ok: false;
      code:
        | "not_found"
        | "expired"
        | "not_lobby"
        | "forbidden"
        | "not_ready"
        | "lineup_incomplete"
        | "version_conflict";
    }
> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return { ok: false, code: "not_found" as const };
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return { ok: false, code: "expired" as const };
    }
    if (session.phase !== "lobby" || !session.lobby) {
      return { ok: false, code: "not_lobby" as const };
    }
    if (session.stateVersion !== input.expectedStateVersion) {
      return { ok: false, code: "version_conflict" as const };
    }
    const host = session.controllers.A;
    if (host.kind !== "human" || host.userId !== input.userId) {
      return { ok: false, code: "forbidden" as const };
    }
    if (!canStartPvp(session, input.config)) {
      const lobby = session.lobby!;
      for (const side of ["A", "B"] as const) {
        if (session.controllers[side].kind !== "human") continue;
        const raw = side === "A" ? lobby.teamA : lobby.teamB;
        if (!raw || !validateLineupTeam(input.config, raw)) {
          return { ok: false, code: "lineup_incomplete" as const };
        }
      }
      return { ok: false, code: "not_ready" as const };
    }
    const lobby = session.lobby;
    let teamA: [string, string, string];
    let teamB: [string, string, string];
    if (session.controllers.A.kind === "ai") {
      teamA = lobby.teamA ?? randomTeamFromConfig(input.config);
    } else {
      teamA = lobby.teamA!;
    }
    if (session.controllers.B.kind === "ai") {
      teamB = lobby.teamB ?? randomTeamFromConfig(input.config);
    } else {
      teamB = lobby.teamB!;
    }
    session.state = createBattleState({
      config: input.config,
      seed: randomUUID(),
      teamA,
      teamB,
    });
    session.phase = "battle";
    session.lobby = null;
    session.pendingActions = {};
    session.stateVersion += 1;
    session.updatedAt = nowIso();
    session.status = session.state.ended ? "finished" : "pending";

    await fillAiActionIfNeeded(session, input.config, "A");
    await fillAiActionIfNeeded(session, input.config, "B");
    await resolveOneTurnIfReady(session, input.config);
    await persistProgressIfBattleEnded(session);
    touchAwaitingHumanClock(session);
    session.updatedAt = nowIso();
    return { ok: true, session };
  });
}

/** PvP 终局后由房主将同一房间重置为战前大厅，便于再来一局（同一 sessionId / 邀请链接） */
export async function resetPvpSessionToLobby(input: {
  sessionId: string;
  userId: string;
  expectedStateVersion: number;
}): Promise<
  | { ok: true; session: BattleSession }
  | {
      ok: false;
      code:
        | "not_found"
        | "expired"
        | "forbidden"
        | "not_battle_ended"
        | "version_conflict";
    }
> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return { ok: false, code: "not_found" as const };
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return { ok: false, code: "expired" as const };
    }
    if (session.mode !== "pvp") {
      return { ok: false, code: "forbidden" as const };
    }
    if (session.phase !== "battle" || !session.state?.ended) {
      return { ok: false, code: "not_battle_ended" as const };
    }
    if (session.stateVersion !== input.expectedStateVersion) {
      return { ok: false, code: "version_conflict" as const };
    }
    const host = session.controllers.A;
    if (host.kind !== "human" || host.userId !== input.userId) {
      return { ok: false, code: "forbidden" as const };
    }
    session.phase = "lobby";
    session.lobby = {
      teamA: null,
      teamB: null,
      readyA: false,
      readyB: false,
    };
    session.state = null;
    session.pendingActions = {};
    session.status = "pending";
    session.progressPersistedAt = null;
    session.awaitingHumanSince = null;
    session.lastAutopilot = null;
    session.stateVersion += 1;
    session.updatedAt = nowIso();
    return { ok: true, session };
  });
}

