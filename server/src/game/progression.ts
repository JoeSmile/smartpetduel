import { updateBattleProgressWithRetry } from "../neo4j/queries.js";
import type { BattleState } from "./engine.js";

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

export async function persistBattleProgress(input: {
  playerId: string;
  state: BattleState;
  side?: "A" | "B";
}): Promise<"ok" | "skipped"> {
  const team = input.side === "B" ? input.state.teamB : input.state.teamA;
  const usedPetIds = team.roster.map((x) => x.petId);
  const pairBattlesMap = new Map<string, { petAId: string; petBId: string; battles: number }>();
  for (let i = 0; i < team.roster.length; i += 1) {
    for (let j = i + 1; j < team.roster.length; j += 1) {
      const petAId = team.roster[i].petId;
      const petBId = team.roster[j].petId;
      pairBattlesMap.set(pairKey(petAId, petBId), { petAId, petBId, battles: 1 });
    }
  }
  const pairBattles = Array.from(pairBattlesMap.values());
  return updateBattleProgressWithRetry({
    playerId: input.playerId,
    petIds: usedPetIds,
    pairBattles,
  });
}

