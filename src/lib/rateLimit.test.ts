import { describe, expect, it } from "vitest";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { isWithinLimit } from "./rateLimit.js";

describe("isWithinLimit", () => {
  it("allows calls up to the limit", async () => {
    const limiter = new RateLimiterMemory({ points: 3, duration: 1 });
    const key = crypto.randomUUID();
    expect(await isWithinLimit(limiter, key)).toBe(true);
    expect(await isWithinLimit(limiter, key)).toBe(true);
    expect(await isWithinLimit(limiter, key)).toBe(true);
  });

  it("rejects once the limit is exceeded within the window", async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 1 });
    const key = crypto.randomUUID();
    await isWithinLimit(limiter, key);
    await isWithinLimit(limiter, key);
    expect(await isWithinLimit(limiter, key)).toBe(false);
  });

  it("tracks separate keys independently", async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 1 });
    const keyA = crypto.randomUUID();
    const keyB = crypto.randomUUID();
    await isWithinLimit(limiter, keyA);
    expect(await isWithinLimit(limiter, keyA)).toBe(false);
    expect(await isWithinLimit(limiter, keyB)).toBe(true);
  });
});