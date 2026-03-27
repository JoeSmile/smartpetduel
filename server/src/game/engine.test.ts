import { test } from "node:test";
import assert from "node:assert/strict";
import { loadGameConfig } from "../config/loadGameConfig.js";
import { createBattleState, resolveTurn } from "./engine.js";
import { CURRENT_RULESET_ID, checkRulesetCompatible } from "./ruleset.js";

test("deterministic with same seed and actions", async () => {
  const config = await loadGameConfig();
  const teamA: [string, string, string] = ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"];
  const teamB: [string, string, string] = ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"];
  const state1 = createBattleState({ config, seed: "seed-001", teamA, teamB });
  const state2 = createBattleState({ config, seed: "seed-001", teamA, teamB });

  const actionA = { type: "skill", skillId: "SKILL_FIRE_01_A" } as const;
  const actionB = { type: "skill", skillId: "SKILL_GRASS_01_A" } as const;

  resolveTurn({ state: state1, config, actionA, actionB });
  resolveTurn({ state: state2, config, actionA, actionB });

  assert.equal(state1.teamA.roster[0].hp, state2.teamA.roster[0].hp);
  assert.equal(state1.teamB.roster[0].hp, state2.teamB.roster[0].hp);
  assert.deepEqual(state1.events, state2.events);
});

test("ruleset compatibility check", () => {
  assert.equal(
    checkRulesetCompatible({
      runtimeRulesetId: CURRENT_RULESET_ID,
      recordRulesetId: CURRENT_RULESET_ID,
    }),
    "compatible",
  );
  assert.equal(
    checkRulesetCompatible({
      runtimeRulesetId: CURRENT_RULESET_ID,
      recordRulesetId: "old_ruleset",
    }),
    "incompatible",
  );
});

test("combo requires bond level 3", async () => {
  const config = await loadGameConfig();
  const state = createBattleState({
    config,
    seed: "seed-combo-bond",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    bondLevelBySide: {
      A: { "PET_FIRE_01|PET_FIRE_02": 2 },
    },
  });
  resolveTurn({
    state,
    config,
    actionA: { type: "combo", comboId: "COMBO_FIRE_01" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  const rejected = state.events.find((e) => e.type === "action_rejected");
  assert.ok(rejected && rejected.type === "action_rejected");
  if (rejected.type === "action_rejected") {
    assert.equal(rejected.reason, "combo_bond_level_too_low");
  }
});

test("normal skill cooldown and combo cooldown are enforced", async () => {
  const config = await loadGameConfig();
  const state = createBattleState({
    config,
    seed: "seed-cd",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    normalSkillCooldownById: { SKILL_FIRE_01_A: 1 },
    bondLevelBySide: {
      A: { "PET_FIRE_01|PET_FIRE_02": 3 },
    },
  });

  resolveTurn({
    state,
    config,
    actionA: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  resolveTurn({
    state,
    config,
    actionA: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  const skillRejected = state.events.find(
    (e) => e.type === "action_rejected" && e.reason === "skill_on_cooldown",
  );
  assert.ok(skillRejected);

  const state2 = createBattleState({
    config,
    seed: "seed-combo-cd",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    bondLevelBySide: {
      A: { "PET_FIRE_01|PET_FIRE_02": 3 },
    },
  });
  resolveTurn({
    state: state2,
    config,
    actionA: { type: "combo", comboId: "COMBO_FIRE_01" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  resolveTurn({
    state: state2,
    config,
    actionA: { type: "combo", comboId: "COMBO_FIRE_01" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  const comboRejected = state2.events.find(
    (e) => e.type === "action_rejected" && e.reason === "combo_on_cooldown",
  );
  assert.ok(comboRejected);
});

test("aoe splash does not KO bench pets", async () => {
  const config = await loadGameConfig();
  const state = createBattleState({
    config,
    seed: "seed-aoe",
    teamA: ["PET_SPECIAL_01", "PET_SPECIAL_02", "PET_FIRE_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_WATER_01"],
    bondLevelBySide: {
      A: { "PET_SPECIAL_01|PET_SPECIAL_02": 3 },
    },
  });
  state.teamB.roster[1].hp = 1;
  state.teamB.roster[2].hp = 1;
  resolveTurn({
    state,
    config,
    actionA: { type: "combo", comboId: "COMBO_LIGHTNING_01" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  assert.equal(state.teamB.roster[1].hp, 1);
  assert.equal(state.teamB.roster[2].hp, 1);
  assert.equal(state.teamB.roster[1].alive, true);
  assert.equal(state.teamB.roster[2].alive, true);
});

test("bond damage bonus increases skill damage", async () => {
  const config = await loadGameConfig();
  const base = createBattleState({
    config,
    seed: "seed-bond-base",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_WATER_01"],
    battleParams: { bondCritRatePerLevel: 0 },
  });
  const buffed = createBattleState({
    config,
    seed: "seed-bond-buffed",
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_WATER_01"],
    bondLevelBySide: { A: { "PET_FIRE_01|PET_FIRE_02": 3 } },
    battleParams: { bondCritRatePerLevel: 0 },
  });

  resolveTurn({
    state: base,
    config,
    actionA: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });
  resolveTurn({
    state: buffed,
    config,
    actionA: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    actionB: { type: "skill", skillId: "SKILL_GRASS_01_A" },
  });

  assert.ok(
    buffed.teamB.roster[0].hp < base.teamB.roster[0].hp,
    "buffed bond should deal more damage",
  );
});

