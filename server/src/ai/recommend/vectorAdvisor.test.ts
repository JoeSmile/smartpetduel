import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameConfigJson } from "../../config/loadGameConfig.js";
import {
  clearAdviceDocsForTest,
  explainLineupRecommendation,
  querySimilarAdvice,
  querySimilarPets,
  upsertAdviceDoc,
} from "./vectorAdvisor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadFixtureConfig(): Promise<GameConfigJson> {
  const root = path.resolve(__dirname, "../../../../config/game.json");
  const raw = await readFile(root, "utf-8");
  return JSON.parse(raw) as GameConfigJson;
}

function stubNoLlm(): () => void {
  const prev = {
    LLM_API_KEY: process.env.LLM_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY,
    LLM_BASE_URL: process.env.LLM_BASE_URL,
  };
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  process.env.DASHSCOPE_API_KEY = "";
  process.env.LLM_BASE_URL = "";
  return () => {
    process.env.LLM_API_KEY = prev.LLM_API_KEY;
    process.env.OPENAI_API_KEY = prev.OPENAI_API_KEY;
    process.env.DASHSCOPE_API_KEY = prev.DASHSCOPE_API_KEY;
    process.env.LLM_BASE_URL = prev.LLM_BASE_URL;
  };
}

test("query similar lineup advice docs", async () => {
  const restore = stubNoLlm();
  try {
    clearAdviceDocsForTest();
    await upsertAdviceDoc({
      id: "lineup-fire",
      type: "lineup",
      text: "PET_FIRE_01 PET_FIRE_02 PET_WATER_01 aggressive lineup",
    });
    await upsertAdviceDoc({
      id: "lineup-grass",
      type: "lineup",
      text: "PET_GRASS_01 PET_GRASS_02 PET_WATER_01 sustain lineup",
    });
    await upsertAdviceDoc({
      id: "report-1",
      type: "battle_report",
      text: "Round 7 ended by combo burst",
    });

    const result = await querySimilarAdvice({
      queryText: "PET_FIRE_01 PET_FIRE_02 burst",
      type: "lineup",
      topK: 2,
    });

    assert.equal(result.length, 2);
    assert.equal(result[0]?.id, "lineup-fire");
    assert.equal(result.every((x) => x.type === "lineup"), true);
  } finally {
    restore();
  }
});

test("pet catalog similarity + lineup explanation (content embedding)", async () => {
  const restore = stubNoLlm();
  try {
    clearAdviceDocsForTest();
    const config = await loadFixtureConfig();
    const hits = await querySimilarPets({
      petId: "PET_FIRE_01",
      config,
      topK: 4,
    });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0]?.type, "pet_profile");
    const explained = await explainLineupRecommendation({
      petIds: ["PET_FIRE_01", "PET_WATER_01"],
      config,
      topK: 2,
    });
    assert.ok(explained.members.length >= 1);
    assert.ok(explained.summary.length > 0);
    assert.equal(explained.note, "explanatory_similarity_only_no_stat_override");
  } finally {
    restore();
  }
});

