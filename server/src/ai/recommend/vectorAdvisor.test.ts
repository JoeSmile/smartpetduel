import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearAdviceDocsForTest,
  querySimilarAdvice,
  upsertAdviceDoc,
} from "./vectorAdvisor.js";

test("query similar lineup advice docs", async () => {
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
});

