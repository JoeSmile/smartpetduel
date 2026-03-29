import type { BattleAction, BattleState } from "../game/engine.js";

export type BattleMode = "pvp" | "pve" | "aivai";
export type PlayerSide = "A" | "B";
export type ControllerKind = "human" | "ai";
export type Difficulty = "easy" | "medium" | "hard";
export type ClientChannel = "web" | "openclaw" | "doubao";

export type SideController = {
  kind: ControllerKind;
  userId: string | null;
  aiDifficulty?: Difficulty;
};

/** PvP 战前大厅：双方选阵与准备；开战前可无 BattleState */
export type PvpLobbySnapshot = {
  teamA: [string, string, string] | null;
  teamB: [string, string, string] | null;
  readyA: boolean;
  readyB: boolean;
};

export type BattleSessionPhase = "lobby" | "battle";

export type BattleSession = {
  sessionId: string;
  mode: BattleMode;
  rulesetId: string;
  createdAt: string;
  updatedAt: string;
  progressPersistedAt: string | null;
  stateVersion: number;
  ttlSec: number;
  status: "pending" | "running" | "finished";
  controllers: Record<PlayerSide, SideController>;
  pendingActions: Partial<Record<PlayerSide, BattleAction>>;
  phase: BattleSessionPhase;
  lobby: PvpLobbySnapshot | null;
  /** 大厅阶段为 null，开战由 startPvpBattle / createBattleSession 写入 */
  state: BattleState | null;
  /** PvE：单方人类操作时限，超时由规则 AI 代打（九节 6） */
  humanTurnTimeoutSec: number;
  /** 等待人类提交本回合操作的起始时间；仅 shouldAutopilotHuman 时有效 */
  awaitingHumanSince: string | null;
  /** 最近一次因超时触发的托管 */
  lastAutopilot: { side: PlayerSide; at: string } | null;
  /** 客户端入口埋点（web / openclaw / doubao） */
  clientChannel: ClientChannel | null;
};

export type SubmitActionPayload = {
  sessionId: string;
  side: PlayerSide;
  action: BattleAction;
  expectedStateVersion: number;
};

export function inferBattleMode(controllers: Record<PlayerSide, SideController>): BattleMode {
  const a = controllers.A.kind;
  const b = controllers.B.kind;
  if (a === "human" && b === "human") return "pvp";
  if (a === "ai" && b === "ai") return "aivai";
  return "pve";
}

export function assertSideControlledByUser(input: {
  session: BattleSession;
  side: PlayerSide;
  userId: string;
}): boolean {
  const ctrl = input.session.controllers[input.side];
  return ctrl.kind === "human" && ctrl.userId === input.userId;
}

export function humanSides(session: BattleSession): PlayerSide[] {
  return (["A", "B"] as const).filter((s) => session.controllers[s].kind === "human");
}

/** 仅单边人类时启用超时托管（典型 PvE） */
export function shouldAutopilotHuman(session: BattleSession): boolean {
  return humanSides(session).length === 1;
}

