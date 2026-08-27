import { retryDelay, shouldRetry } from "./retry-policy.js";

export async function fetchWithRetry(request, options) {
  const { maxAttempts, baseDelayMs, sleep } = options;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await request();
      if (!shouldRetry(response.status) || attempt === maxAttempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
    }
    await sleep(retryDelay(attempt, baseDelayMs));
  }
  throw lastError;
}
