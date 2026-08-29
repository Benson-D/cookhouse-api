import { RateLimiterMemory } from "rate-limiter-flexible";

/**
 * Consumes one point from `limiter` for `key`, returning whether `key` was
 * still within its limit. False on a rate-limit rejection (rate-limiter-flexible
 * rejects with a `RateLimiterRes`, not an `Error`, for that case) — a real
 * `Error` from the limiter itself still propagates, since that's a bug, not
 * a limit being hit.
 */
export async function isWithinLimit(limiter: RateLimiterMemory, key: string): Promise<boolean> {
  try {
    await limiter.consume(key);
    return true;
  } catch (rejection) {
    if (rejection instanceof Error) {
      throw rejection;
    }
    return false;
  }
}