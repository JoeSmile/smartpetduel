import { after, test } from "node:test";
import assert from "node:assert/strict";
import { loadGameConfig } from "../config/loadGameConfig.js";
import { createBattleSession, getBattleSession, submitBattleAction } from "./sessionService.js";
import { closeNeo4jDriver } from "../neo4j/driver.js";

after(async () => {
  await closeNeo4jDriver();
});

test("pve session submit resolves one turn with ai side", async () => {
  const config = await loadGameConfig();
  const session = createBattleSession({
    config,
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    controllers: {
      A: { kind: "human", userId: "u1" },
      B: { kind: "ai", userId: null, aiDifficulty: "easy" },
    },
  });

  const beforeRound = session.state.round;
  const submit = await submitBattleAction({
    config,
    sessionId: session.sessionId,
    side: "A",
    action: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    expectedStateVersion: session.stateVersion,
    userId: "u1",
  });
  assert.equal(submit.ok, true);
  if (submit.ok) {
    assert.ok(submit.session.state.round > beforeRound);
  }
});

test("session lookup works", async () => {
  const config = await loadGameConfig();
  const session = createBattleSession({
    config,
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    controllers: {
      A: { kind: "human", userId: "u1" },
      B: { kind: "human", userId: "u2" },
    },
  });
  const found = await getBattleSession(session.sessionId);
  assert.ok(found);
  assert.equal(found?.sessionId, session.sessionId);
});

test("persists battle progress once when session ends", async () => {
  const config = await loadGameConfig();
  const session = createBattleSession({
    config,
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    controllers: {
      A: { kind: "human", userId: "u1" },
      B: { kind: "ai", userId: null, aiDifficulty: "easy" },
    },
  });

  // Force quick finish so submit path can trigger progress persistence.
  session.state.teamB.roster[0].hp = 1;
  session.state.teamB.roster[1].alive = false;
  session.state.teamB.roster[2].alive = false;

  const submit = await submitBattleAction({
    config,
    sessionId: session.sessionId,
    side: "A",
    action: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    expectedStateVersion: session.stateVersion,
    userId: "u1",
  });
  assert.equal(submit.ok, true);
  if (submit.ok) {
    assert.equal(submit.session.state.ended, true);
    assert.ok(submit.session.progressPersistedAt);
  }
});

