import { randomUUID } from "node:crypto";
import type { GameConfigJson } from "../config/loadGameConfig.js";
import { resolveTurn, createBattleState, type BattleAction } from "../game/engine.js";
import { CURRENT_RULESET_ID } from "../game/ruleset.js";
import { persistBattleProgress } from "../game/progression.js";
import {
  type BattleSession,
  type PlayerSide,
  type SideController,
  assertSideControlledByUser,
  inferBattleMode,
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

async function resolveOneTurnIfReady(
  session: BattleSession,
  config: GameConfigJson,
): Promise<void> {
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
  if (!session.state.ended || session.progressPersistedAt) return;
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

async function autoRunAivai(session: BattleSession, config: GameConfigJson): Promise<void> {
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
}): BattleSession {
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
    state: createBattleState({
      config: input.config,
      seed: input.seed ?? randomUUID(),
      teamA: input.teamA,
      teamB: input.teamB,
    }),
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
  | { ok: false; code: "not_found" | "expired" | "finished" | "forbidden" | "version_conflict" }
> {
  return withSessionLock(input.sessionId, async () => {
    const session = sessions.get(input.sessionId);
    if (!session) return { ok: false, code: "not_found" as const };
    if (!ensureNotExpired(session)) {
      sessions.delete(input.sessionId);
      return { ok: false, code: "expired" as const };
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
    if (session.state.ended) return session;
    await fillAiActionIfNeeded(session, input.config, "A");
    await fillAiActionIfNeeded(session, input.config, "B");
    await resolveOneTurnIfReady(session, input.config);
    if (session.mode === "aivai" && !session.state.ended) {
      await autoRunAivai(session, input.config);
    }
    await persistProgressIfBattleEnded(session);
    return session;
  });
}

