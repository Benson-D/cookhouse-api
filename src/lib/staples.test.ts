import { describe, expect, it } from "vitest";
import { computeFreshlyStocked, DAY_MS } from "./staples.js";

describe("computeFreshlyStocked", () => {
  const now = Date.parse("2026-08-22T00:00:00Z");

  it("treats a staple checked off within its own frequency as fresh", () => {
    const staples = [{ ingredientId: "bread", frequencyDays: 7 }];
    const lastCheckedAt = new Map([["bread", new Date(now - 3 * DAY_MS)]]);

    expect(computeFreshlyStocked(staples, lastCheckedAt, now)).toEqual(new Set(["bread"]));
  });

  it("treats a staple checked off outside its frequency as not fresh", () => {
    const staples = [{ ingredientId: "bread", frequencyDays: 7 }];
    const lastCheckedAt = new Map([["bread", new Date(now - 10 * DAY_MS)]]);

    expect(computeFreshlyStocked(staples, lastCheckedAt, now)).toEqual(new Set());
  });

  it("treats a staple that was never checked off as not fresh", () => {
    const staples = [{ ingredientId: "bread", frequencyDays: 7 }];

    expect(computeFreshlyStocked(staples, new Map(), now)).toEqual(new Set());
  });

  it("evaluates each staple against its own frequency independently", () => {
    const staples = [
      { ingredientId: "bread", frequencyDays: 7 },
      { ingredientId: "milk", frequencyDays: 3 },
    ];
    const lastCheckedAt = new Map([
      ["bread", new Date(now - 5 * DAY_MS)],
      ["milk", new Date(now - 5 * DAY_MS)],
    ]);

    expect(computeFreshlyStocked(staples, lastCheckedAt, now)).toEqual(new Set(["bread"]));
  });
});
