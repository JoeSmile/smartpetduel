import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEloPair, DEFAULT_ELO, expectedScore } from "./elo.js";

test("expectedScore: equal ratings → 0.5", () => {
  assert.equal(expectedScore(1500, 1500), 0.5);
});

test("computeEloPair: higher rated wins → small change", () => {
  const { newRa, newRb } = computeEloPair(1600, 1400, 1);
  assert.ok(newRa > 1600);
  assert.ok(newRb < 1400);
});

test("computeEloPair: DEFAULT_ELO symmetric loss", () => {
  const { newRa, newRb } = computeEloPair(DEFAULT_ELO, DEFAULT_ELO, 0);
  assert.equal(newRa, DEFAULT_ELO - 16);
  assert.equal(newRb, DEFAULT_ELO + 16);
});
