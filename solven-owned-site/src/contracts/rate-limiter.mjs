export const RATE_LIMITER_OPERATIONS = Object.freeze(["consume"]);

export function assertRateLimiter(adapter) {
  if (!adapter || typeof adapter !== "object" || typeof adapter.consume !== "function") {
    throw new TypeError("rate_limiter_operation_missing:consume");
  }
  return adapter;
}

export function assertRateLimitResult(result) {
  if (!result || typeof result.allowed !== "boolean") throw new TypeError("invalid_rate_limit_result");
  if (!result.allowed && (!Number.isInteger(result.retryAfterSeconds) || result.retryAfterSeconds < 1)) {
    throw new TypeError("invalid_retry_after");
  }
  return result;
}
