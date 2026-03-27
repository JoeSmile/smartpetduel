import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameConfig } from "../../config/loadGameConfig.js";
import { createBattleState } from "../../game/engine.js";
import { listLegalActions } from "./legalActions.js";

test("legal action list includes skill and combo when ready", async () => {
  const config = await loadGameConfig();
  const state = createBattleState({
    config,
    seed: "legal-seed",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    bondLevelBySide: {
      A: { "PET_FIRE_01|PET_FIRE_02": 3 },
    },
  });
  const legal = listLegalActions({ state, config, side: "A" });
  assert.ok(legal.find((x) => x.key === "skill:SKILL_FIRE_01_A"));
  assert.ok(legal.find((x) => x.key === "combo:COMBO_FIRE_01"));
});

