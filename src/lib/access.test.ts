import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { PrismaClient, Role } from "@prisma/client";
import { assertCanModify, isAdmin } from "./access.js";

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

const actor = { clerkOrgId: "org_1", clerkUserId: "user_author" };
const ownRow = { clerkOrgId: "org_1", createdBy: "user_author" };
const othersRow = { clerkOrgId: "org_1", createdBy: "user_other" };

async function codeFor(promise: Promise<unknown>) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof TRPCError ? error.code : "UNKNOWN";
  }
}

describe("isAdmin", () => {
  it.each([
    ["ADMIN", true],
    ["DEVELOPER", true],
    ["CLIENT", false],
  ] as const)("%s -> %s", async (role, expected) => {
    expect(await isAdmin(stubPrisma(role), "user_1")).toBe(expected);
  });

  it("is false when no local user row exists yet", async () => {
    expect(await isAdmin(stubPrisma(), "user_1")).toBe(false);
  });
});

describe("assertCanModify", () => {
  it("allows the author", async () => {
    await expect(
      assertCanModify(stubPrisma("CLIENT"), ownRow, actor)
    ).resolves.toBeUndefined();
  });

  it("allows an admin who is not the author", async () => {
    await expect(
      assertCanModify(stubPrisma("ADMIN"), othersRow, actor)
    ).resolves.toBeUndefined();
  });

  it("rejects a non-author, non-admin household member", async () => {
    expect(await codeFor(assertCanModify(stubPrisma("CLIENT"), othersRow, actor))).toBe(
      "FORBIDDEN"
    );
  });

  // NOT_FOUND rather than FORBIDDEN on purpose: a FORBIDDEN here would confirm
  // that a given id exists in some other household.
  it("reports another household's row as NOT_FOUND", async () => {
    const foreign = { clerkOrgId: "org_2", createdBy: "user_author" };
    expect(await codeFor(assertCanModify(stubPrisma("CLIENT"), foreign, actor))).toBe(
      "NOT_FOUND"
    );
  });

  it("reports a missing row as NOT_FOUND", async () => {
    expect(await codeFor(assertCanModify(stubPrisma("CLIENT"), null, actor))).toBe(
      "NOT_FOUND"
    );
  });

  it("does not let an admin reach into another household", async () => {
    const foreign = { clerkOrgId: "org_2", createdBy: "user_other" };
    expect(await codeFor(assertCanModify(stubPrisma("ADMIN"), foreign, actor))).toBe(
      "NOT_FOUND"
    );
  });
});
