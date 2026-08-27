import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWithRetry } from "../src/client.js";

test("returns a successful response", async () => {
  const response = await fetchWithRetry(async () => ({ status: 200 }), {
    maxAttempts: 3, baseDelayMs: 10, sleep: async () => {}
  });
  assert.equal(response.status, 200);
});
