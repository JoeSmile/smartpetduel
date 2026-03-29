/**
 * 阶段五·续 / 阶段六：Neo4j 天梯与战后写入、RAG/Phase2 降级路径的轻量验收（不依赖真实 Neo4j）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBattleCommentary } from "../ai/commentary/battleCommentary.js";
import { parseNlToAllowlistIntent } from "../ai/nl/allowlistQuery.js";
import { computeEloPair } from "../game/elo.js";
import { closeNeo4jDriver } from "./driver.js";
import { updateBattleProgressWithRetry } from "./queries.js";

test("phase6: Neo4j 未配置时战后写入跳过且不抛错", async () => {
  await closeNeo4jDriver();
  const saved = {
    uri: process.env.NEO4J_URI,
    user: process.env.NEO4J_USER,
    pass: process.env.NEO4J_PASSWORD,
  };
  try {
    delete process.env.NEO4J_URI;
    delete process.env.NEO4J_USER;
    delete process.env.NEO4J_PASSWORD;
    const r = await updateBattleProgressWithRetry({
      playerId: "offline-test-player",
      petIds: ["PET_FIRE_01"],
      pairBattles: [],
      maxAttempts: 1,
    });
    assert.equal(r, "skipped");
  } finally {
    if (saved.uri !== undefined) process.env.NEO4J_URI = saved.uri;
    if (saved.user !== undefined) process.env.NEO4J_USER = saved.user;
    if (saved.pass !== undefined) process.env.NEO4J_PASSWORD = saved.pass;
  }
});

test("phase6: PvP Elo 更新公式可用（天梯分写入逻辑的基础）", () => {
  const { newRa, newRb } = computeEloPair(1500, 1500, 1);
  assert.ok(newRa > 1500);
  assert.ok(newRb < 1500);
});

test("phase6: RAG Phase2 — NL allowlist 拒绝任意 Cypher", () => {
  assert.equal(parseNlToAllowlistIntent("MATCH (n) DETACH DELETE n"), null);
});

test("phase6: RAG Phase2 — 解说关闭时不调用 LLM", async () => {
  const prev = process.env.COMMENTARY_ENABLED;
  try {
    process.env.COMMENTARY_ENABLED = "false";
    const out = await generateBattleCommentary({
      round: 1,
      events: [],
      llm: async () => {
        throw new Error("should not be called");
      },
    });
    assert.equal(out.enabled, false);
    assert.ok(out.commentary.length > 0);
  } finally {
    process.env.COMMENTARY_ENABLED = prev;
  }
});
