import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameConfig } from "../../config/loadGameConfig.js";
import { createBattleState } from "../../game/engine.js";
import { decideBattleAiAction } from "./langgraphAgent.js";

test("langgraph agent returns legal action with fallback", async () => {
  const config = await loadGameConfig();
  const state = createBattleState({
    config,
    seed: "agent-seed",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    bondLevelBySide: {
      A: { "PET_FIRE_01|PET_FIRE_02": 3 },
    },
  });
  const result = await decideBattleAiAction({
    state,
    config,
    side: "A",
    difficulty: "medium",
  });
  assert.ok(result.legalActions.length > 0);
  assert.ok(result.action, "should pick one legal action");
});

