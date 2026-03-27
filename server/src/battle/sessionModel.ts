import type { BattleAction, BattleState } from "../game/engine.js";

export type BattleMode = "pvp" | "pve" | "aivai";
export type PlayerSide = "A" | "B";
export type ControllerKind = "human" | "ai";
export type Difficulty = "easy" | "medium" | "hard";

export type SideController = {
  kind: ControllerKind;
  userId: string | null;
  aiDifficulty?: Difficulty;
};

export type BattleSession = {
  sessionId: string;
  mode: BattleMode;
  rulesetId: string;
  createdAt: string;
  updatedAt: string;
  stateVersion: number;
  ttlSec: number;
  status: "pending" | "running" | "finished";
  controllers: Record<PlayerSide, SideController>;
  pendingActions: Partial<Record<PlayerSide, BattleAction>>;
  state: BattleState;
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

