import { test } from "node:test";
import assert from "node:assert/strict";
import type { BattleEvent } from "../../game/engine.js";
import { generateBattleCommentary } from "./battleCommentary.js";

test("returns disabled marker when commentary off", async () => {
  const prev = process.env.COMMENTARY_ENABLED;
  try {
    process.env.COMMENTARY_ENABLED = "false";
    const out = await generateBattleCommentary({
      round: 1,
      events: [],
    });
    assert.equal(out.enabled, false);
    assert.equal(out.commentary, "commentary_disabled");
    assert.equal(out.fallbackUsed, true);
  } finally {
    process.env.COMMENTARY_ENABLED = prev;
  }
});

test("falls back to template when llm fails", async () => {
  const prev = process.env.COMMENTARY_ENABLED;
  try {
    process.env.COMMENTARY_ENABLED = "true";
    const events: BattleEvent[] = [
      { type: "damage", from: "A", to: "B", amount: 24, actionId: "SKILL_FIRE_01_A" },
      { type: "ko", side: "B", petId: "PET_GRASS_01" },
    ];
    const out = await generateBattleCommentary({
      round: 2,
      events,
      llm: async () => {
        throw new Error("mock_fail");
      },
    });
    assert.equal(out.enabled, true);
    assert.equal(out.fallbackUsed, true);
    assert.ok(out.commentary.includes("24"));
  } finally {
    process.env.COMMENTARY_ENABLED = prev;
  }
});

