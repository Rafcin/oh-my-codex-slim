import assert from "node:assert/strict";
import { grade, moduleUrl } from "./lib.mjs";

await grade(["src/client.js", "src/retry-policy.js", "test/"], async () => {
  const { fetchWithRetry } = await import(moduleUrl("src/client.js"));
  const calls = [];
  const delays = [];
  const responses = [{ status: 500 }, { status: 429 }, { status: 204 }];
  const response = await fetchWithRetry(async () => { calls.push(true); return responses.shift(); }, {
    maxAttempts: 3, baseDelayMs: 10, sleep: async (delay) => { delays.push(delay); }
  });
  assert.equal(response.status, 204);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10, 20]);

  let clientCalls = 0;
  const clientError = await fetchWithRetry(async () => { clientCalls += 1; return { status: 400 }; }, {
    maxAttempts: 4, baseDelayMs: 1, sleep: async () => {}
  });
  assert.equal(clientError.status, 400);
  assert.equal(clientCalls, 1);

  const finalResponses = [{ status: 503 }, { status: 429 }];
  const finalDelays = [];
  const finalResponse = await fetchWithRetry(async () => finalResponses.shift(), {
    maxAttempts: 2,
    baseDelayMs: 7,
    sleep: async (delay) => { finalDelays.push(delay); }
  });
  assert.equal(finalResponse.status, 429);
  assert.equal(finalResponses.length, 0);
  assert.deepEqual(finalDelays, [7]);

  const finalError = new Error("final transport failure");
  let attempts = 0;
  await assert.rejects(() => fetchWithRetry(async () => {
    attempts += 1;
    throw attempts === 2 ? finalError : new Error("first transport failure");
  }, { maxAttempts: 2, baseDelayMs: 1, sleep: async () => {} }), (error) => error === finalError);
});
