import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlannerActionBySchema } from "./promptProtocol.js";

test("accepts valid planner output by schema", () => {
  const out = parsePlannerActionBySchema({
    raw: JSON.stringify({ actionKey: "skill:SKILL_FIRE_01_A" }),
    allowedActionKeys: ["skill:SKILL_FIRE_01_A", "switch:1"],
  });
  assert.equal(out, "skill:SKILL_FIRE_01_A");
});

test("rejects unknown action key and malformed payload", () => {
  const unknown = parsePlannerActionBySchema({
    raw: JSON.stringify({ actionKey: "skill:UNKNOWN" }),
    allowedActionKeys: ["skill:SKILL_FIRE_01_A", "switch:1"],
  });
  assert.equal(unknown, "");

  const malformed = parsePlannerActionBySchema({
    raw: "not json",
    allowedActionKeys: ["skill:SKILL_FIRE_01_A"],
  });
  assert.equal(malformed, "");
});

