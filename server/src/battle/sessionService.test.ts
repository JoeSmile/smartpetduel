import { after, test } from "node:test";
import assert from "node:assert/strict";
import { loadGameConfig } from "../config/loadGameConfig.js";
import {
  createBattleSession,
  createPvpLobbySession,
  getBattleSession,
  kickAiIfNeeded,
  setPvpLineup,
  resetPvpSessionToLobby,
  setPvpReady,
  startPvpBattle,
  submitBattleAction,
} from "./sessionService.js";
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

  const beforeRound = session.state!.round;
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
    assert.ok(submit.session.state!.round > beforeRound);
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

test("pve human turn timeout triggers autopilot (rule fallback)", async () => {
  const config = await loadGameConfig();
  const session = createBattleSession({
    config,
    teamA: ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"],
    teamB: ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"],
    controllers: {
      A: { kind: "human", userId: "u1" },
      B: { kind: "ai", userId: null, aiDifficulty: "easy" },
    },
    humanTurnTimeoutSec: 0,
    clientChannel: "web",
  });
  assert.equal(session.clientChannel, "web");
  const before = session.state!.round;
  const afterKick = await kickAiIfNeeded({ config, sessionId: session.sessionId });
  assert.ok(afterKick);
  assert.ok(afterKick!.lastAutopilot);
  assert.equal(afterKick!.lastAutopilot?.side, "A");
  assert.ok(afterKick!.state!.round > before || afterKick!.state!.ended);
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
  session.state!.teamB.roster[0].hp = 1;
  session.state!.teamB.roster[1].alive = false;
  session.state!.teamB.roster[2].alive = false;

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
    assert.equal(submit.session.state!.ended, true);
    assert.ok(submit.session.progressPersistedAt);
  }
});

test("pvp lobby: lineup → ready → start → submit", async () => {
  const config = await loadGameConfig();
  const session = createPvpLobbySession({
    config,
    controllers: {
      A: { kind: "human", userId: "ua" },
      B: { kind: "human", userId: "ub" },
    },
  });
  assert.equal(session.phase, "lobby");
  assert.equal(session.state, null);

  const ta: [string, string, string] = ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"];
  const tb: [string, string, string] = ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"];

  const l1 = await setPvpLineup({
    config,
    sessionId: session.sessionId,
    side: "A",
    team: ta,
    userId: "ua",
    expectedStateVersion: 1,
  });
  assert.equal(l1.ok, true);
  const l2 = await setPvpLineup({
    config,
    sessionId: session.sessionId,
    side: "B",
    team: tb,
    userId: "ub",
    expectedStateVersion: l1.ok ? l1.session.stateVersion : 1,
  });
  assert.equal(l2.ok, true);
  const r1 = await setPvpReady({
    config,
    sessionId: session.sessionId,
    side: "A",
    userId: "ua",
    expectedStateVersion: l2.ok ? l2.session.stateVersion : 1,
  });
  assert.equal(r1.ok, true);
  const r2 = await setPvpReady({
    config,
    sessionId: session.sessionId,
    side: "B",
    userId: "ub",
    expectedStateVersion: r1.ok ? r1.session.stateVersion : 1,
  });
  assert.equal(r2.ok, true);

  const st = await startPvpBattle({
    config,
    sessionId: session.sessionId,
    userId: "ua",
    expectedStateVersion: r2.ok ? r2.session.stateVersion : 1,
  });
  assert.equal(st.ok, true);
  if (!st.ok) return;
  assert.equal(st.session.phase, "battle");
  assert.ok(st.session.state);

  const sub = await submitBattleAction({
    config,
    sessionId: session.sessionId,
    side: "A",
    action: { type: "skill", skillId: "SKILL_FIRE_01_A" },
    expectedStateVersion: st.session.stateVersion,
    userId: "ua",
  });
  assert.equal(sub.ok, true);
});

test("pvp rematch: reset to lobby after battle ended (host only)", async () => {
  const config = await loadGameConfig();
  const session = createPvpLobbySession({
    config,
    controllers: {
      A: { kind: "human", userId: "ua" },
      B: { kind: "human", userId: "ub" },
    },
  });
  const ta: [string, string, string] = ["PET_FIRE_01", "PET_FIRE_02", "PET_WATER_01"];
  const tb: [string, string, string] = ["PET_GRASS_01", "PET_GRASS_02", "PET_SPECIAL_01"];
  for (const step of [
    await setPvpLineup({
      config,
      sessionId: session.sessionId,
      side: "A",
      team: ta,
      userId: "ua",
      expectedStateVersion: 1,
    }),
    await setPvpLineup({
      config,
      sessionId: session.sessionId,
      side: "B",
      team: tb,
      userId: "ub",
      expectedStateVersion: 2,
    }),
    await setPvpReady({
      config,
      sessionId: session.sessionId,
      side: "A",
      userId: "ua",
      expectedStateVersion: 3,
    }),
    await setPvpReady({
      config,
      sessionId: session.sessionId,
      side: "B",
      userId: "ub",
      expectedStateVersion: 4,
    }),
  ]) {
    assert.equal(step.ok, true);
  }
  const st = await startPvpBattle({
    config,
    sessionId: session.sessionId,
    userId: "ua",
    expectedStateVersion: 5,
  });
  assert.equal(st.ok, true);
  if (!st.ok) return;

  const live = await getBattleSession(session.sessionId);
  assert.ok(live?.state);
  live!.state!.ended = true;
  live!.state!.winner = "A";

  const bad = await resetPvpSessionToLobby({
    sessionId: session.sessionId,
    userId: "ub",
    expectedStateVersion: live.stateVersion,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.code, "forbidden");

  const ok = await resetPvpSessionToLobby({
    sessionId: session.sessionId,
    userId: "ua",
    expectedStateVersion: live.stateVersion,
  });
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.session.phase, "lobby");
  assert.equal(ok.session.state, null);
  assert.equal(ok.session.lobby?.teamA, null);
});

