import type { GameConfigJson } from "../../config/loadGameConfig.js";
import type { BattleAction, BattleState } from "../../game/engine.js";

type Side = "A" | "B";

export type LegalAction = {
  key: string;
  action: BattleAction;
  source: "skill" | "combo" | "switch";
  score: number;
  reason: string;
};

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function getTeam(state: BattleState, side: Side) {
  return side === "A" ? state.teamA : state.teamB;
}

export function listLegalActions(input: {
  state: BattleState;
  config: GameConfigJson;
  side: Side;
}): LegalAction[] {
  const team = getTeam(input.state, input.side);
  const active = team.roster[team.activeIndex];
  if (!active.alive) return [];

  const legal: LegalAction[] = [];

  for (let i = 0 as 0 | 1 | 2; i < 3; i = (i + 1) as 0 | 1 | 2) {
    if (i === team.activeIndex) continue;
    if (!team.roster[i].alive) continue;
    legal.push({
      key: `switch:${i}`,
      action: { type: "switch", toIndex: i },
      source: "switch",
      score: 10,
      reason: "alive_bench_pet",
    });
  }

  const skills = input.config.skills.filter((s) => s.petId === active.petId);
  for (const sk of skills) {
    const readyRound = input.state.skillReadyRoundBySide[input.side][sk.id] ?? 1;
    if (input.state.round < readyRound) continue;
    legal.push({
      key: `skill:${sk.id}`,
      action: { type: "skill", skillId: sk.id },
      source: "skill",
      score: Math.max(20, Math.floor(sk.coefficient * 100)),
      reason: "skill_ready",
    });
  }

  const combos = input.config.comboSkills.filter((c) => c.petAId === active.petId);
  for (const combo of combos) {
    const partner = team.roster.find((p) => p.petId === combo.petBId);
    if (!partner || !partner.alive) continue;
    const pairBond = input.state.bondLevelBySide[input.side][pairKey(combo.petAId, combo.petBId)] ?? 0;
    if (pairBond < 3) continue;
    const readyRound = input.state.comboReadyRoundBySide[input.side][combo.id] ?? 1;
    if (input.state.round < readyRound) continue;
    const usedCount = input.state.comboUsageBySide[input.side][combo.id] ?? 0;
    if (usedCount >= 2) continue;
    legal.push({
      key: `combo:${combo.id}`,
      action: { type: "combo", comboId: combo.id },
      source: "combo",
      score: Math.max(30, Math.floor(combo.coefficient * 100) + (combo.isAoe ? 15 : 0)),
      reason: "combo_ready",
    });
  }

  legal.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return legal;
}

