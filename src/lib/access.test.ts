import { describe, expect, it } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { isAdmin } from "./access.js";

/**
 * Services take `prisma` as a parameter rather than importing the singleton,
 * so these run against a stub — no database, no test containers.
 */
function stubPrisma(role?: Role) {
  return {
    user: {
      findUnique: async () => (role ? { role } : null),
    },
  } as unknown as PrismaClient;
}

const ADMIN_CASES = [
  ["ADMIN", true],
  ["DEVELOPER", true],
  ["CLIENT", false],
] as const;

describe("isAdmin", () => {
  it.each(ADMIN_CASES)("%s -> %s", async (role, expected) => {
    expect(await isAdmin(stubPrisma(role), "user_1")).toBe(expected);
  });

  it("is false when no local user row exists yet", async () => {
    expect(await isAdmin(stubPrisma(), "user_1")).toBe(false);
  });
});