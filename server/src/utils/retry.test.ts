import { test } from "node:test";
import assert from "node:assert/strict";
import { retryAsync } from "./retry.js";

test("retryAsync retries until success", async () => {
  let count = 0;
  const result = await retryAsync(
    async () => {
      count += 1;
      if (count < 3) throw new Error("temp_fail");
      return "ok";
    },
    { maxAttempts: 4, delayMs: 1 },
  );
  assert.equal(result, "ok");
  assert.equal(count, 3);
});

