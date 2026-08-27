export function shouldRetry(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

export function retryDelay(attempt, baseDelayMs) {
  return baseDelayMs * (2 ** attempt);
}
