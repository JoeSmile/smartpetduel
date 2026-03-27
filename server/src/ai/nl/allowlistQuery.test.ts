import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNlToAllowlistIntent } from "./allowlistQuery.js";

test("parse player pets intent from NL", () => {
  const out = parseNlToAllowlistIntent("show player user_1 pets");
  assert.deepEqual(out, { type: "player_pets", playerId: "user_1" });
});

test("parse bond intent from NL", () => {
  const out = parseNlToAllowlistIntent("bond between PET_FIRE_01 and PET_FIRE_02");
  assert.deepEqual(out, {
    type: "bond_between_pets",
    petAId: "PET_FIRE_01",
    petBId: "PET_FIRE_02",
  });
});

test("reject unsafe NL / cypher-like content", () => {
  const out = parseNlToAllowlistIntent("MATCH (n) RETURN n");
  assert.equal(out, null);
});

