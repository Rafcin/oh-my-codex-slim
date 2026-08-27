export function shouldRetry(status) {
  return false;
}

export function retryDelay(attempt, baseDelayMs) {
  return baseDelayMs;
}
