import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { getForHousehold, remove, update } from "./recipes.service.js";

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  prisma.user.findUnique.mockResolvedValue({ id: "local_1", clerkUserId: "user_1" } as never);
});

describe("getForHousehold", () => {
  it("returns a recipe belonging to the caller's household", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ id: "r1", clerkOrgId: "org_mine" } as never);
    prisma.userFavoriteRecipe.findUnique.mockResolvedValue(null);

    const result = await getForHousehold(prisma, "r1", actor);
    expect(result.isFavorited).toBe(false);
  });

  // NOT_FOUND rather than FORBIDDEN on purpose (see the service's own
  // comment): a FORBIDDEN here would confirm a given id exists elsewhere.
  it("reports another household's recipe as NOT_FOUND", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ id: "r1", clerkOrgId: "org_other" } as never);

    await expect(getForHousehold(prisma, "r1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a missing recipe as NOT_FOUND", async () => {
    prisma.recipe.findUnique.mockResolvedValue(null);

    await expect(getForHousehold(prisma, "missing", actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("update", () => {
  beforeEach(() => {
    prisma.$transaction.mockImplementation(((fn: unknown) =>
      typeof fn === "function" ? fn(prisma) : Promise.resolve(fn)) as never);
  });

  it("updates a recipe belonging to the caller's household", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);
    prisma.recipe.update.mockResolvedValue({ id: "r1", name: "New name" } as never);

    const result = await update(prisma, { id: "r1", name: "New name" } as never, actor);
    expect(result).toMatchObject({ id: "r1" });
  });

  // The behavior change from this session: no author check at all anymore,
  // only household membership — any member may edit, not just whoever
  // created the recipe.
  it("allows a non-author household member to update", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);
    prisma.recipe.update.mockResolvedValue({ id: "r1" } as never);

    await expect(
      update(prisma, { id: "r1", name: "Edited by someone else" } as never, actor)
    ).resolves.toBeDefined();
  });

  it("rejects updating another household's recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(update(prisma, { id: "r1", name: "x" } as never, actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects updating a missing recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue(null);

    await expect(update(prisma, { id: "missing", name: "x" } as never, actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("remove", () => {
  it("deletes a recipe belonging to the caller's household", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);
    prisma.recipe.delete.mockResolvedValue({} as never);

    await expect(remove(prisma, "r1", actor)).resolves.toEqual({ ok: true });
  });

  it("allows a non-author household member to delete", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);
    prisma.recipe.delete.mockResolvedValue({} as never);

    await expect(remove(prisma, "r1", actor)).resolves.toEqual({ ok: true });
  });

  it("rejects deleting another household's recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(remove(prisma, "r1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects deleting a missing recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue(null);

    await expect(remove(prisma, "missing", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});