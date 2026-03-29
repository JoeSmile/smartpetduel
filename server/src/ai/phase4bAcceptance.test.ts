import { test } from "node:test";
import assert from "node:assert/strict";
import type { BattleEvent } from "../game/engine.js";
import { generateBattleCommentary } from "./commentary/battleCommentary.js";
import { parseNlToAllowlistIntent } from "./nl/allowlistQuery.js";

test("appendix B.3: NL allowlist rejects arbitrary Cypher / free text", () => {
  assert.equal(parseNlToAllowlistIntent("MATCH (n) DELETE n"), null);
  assert.equal(parseNlToAllowlistIntent("DROP DATABASE neo4j"), null);
  assert.equal(parseNlToAllowlistIntent("players demo_user pets"), null);
});

test("appendix B.3: allowlist intents are structurally bounded", () => {
  const i1 = parseNlToAllowlistIntent("player demo_user pets");
  assert.equal(i1?.type, "player_pets");
  const i2 = parseNlToAllowlistIntent("bond between PET_FIRE_01 and PET_WATER_01");
  assert.equal(i2?.type, "bond_between_pets");
  const i3 = parseNlToAllowlistIntent("counter fire vs grass");
  assert.equal(i3?.type, "counter_multiplier");
});

test("appendix B.4: fabricated damage digits fall back to template", async () => {
  const prev = process.env.COMMENTARY_ENABLED;
  try {
    process.env.COMMENTARY_ENABLED = "true";
    const events: BattleEvent[] = [
      { type: "damage", from: "A", to: "B", amount: 24, actionId: "SKILL_FIRE_01_A" },
    ];
    const out = await generateBattleCommentary({
      round: 3,
      events,
      llm: async () => ({
        content: "这一击打出了 9999 点爆发伤害。",
      }),
    });
    assert.equal(out.enabled, true);
    assert.equal(out.fallbackUsed, true);
    assert.ok(!out.commentary.includes("9999"));
  } finally {
    process.env.COMMENTARY_ENABLED = prev;
  }
});

test("appendix B.4: commentary may repeat grounded numbers", async () => {
  const prev = process.env.COMMENTARY_ENABLED;
  try {
    process.env.COMMENTARY_ENABLED = "true";
    const events: BattleEvent[] = [
      { type: "damage", from: "A", to: "B", amount: 24, actionId: "SKILL_FIRE_01_A" },
    ];
    const out = await generateBattleCommentary({
      round: 3,
      events,
      llm: async () => ({
        content: "第3回合，伤害24点。",
      }),
    });
    assert.equal(out.enabled, true);
    assert.equal(out.fallbackUsed, false);
    assert.ok(out.commentary.includes("24"));
  } finally {
    process.env.COMMENTARY_ENABLED = prev;
  }
});

test("appendix B.3: parsed intents map only to allowlisted query shapes (no raw Cypher)", () => {
  const intent = parseNlToAllowlistIntent("counter water vs fire");
  assert.equal(intent?.type, "counter_multiplier");
  if (intent?.type === "counter_multiplier") {
    assert.equal(intent.attacker, "water");
    assert.equal(intent.defender, "fire");
  }
});
