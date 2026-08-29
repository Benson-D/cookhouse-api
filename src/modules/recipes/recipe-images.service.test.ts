import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

// Keep the pure key-building/validation logic real; mock only what actually
// touches S3.
vi.mock("../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage.js")>();
  return {
    ...actual,
    createUploadUrl: vi.fn().mockResolvedValue("https://signed.example/upload"),
    createReadUrl: vi.fn().mockResolvedValue("https://signed.example/read"),
    ensureWebSafeImage: vi.fn(async (key: string) => key),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
});

const { attach, createUpload, listWithUrls, remove } = await import("./recipe-images.service.js");

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe("listWithUrls", () => {
  it("returns image URLs for a recipe belonging to the caller's household", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);
    prisma.recipeImage.findMany.mockResolvedValue([
      { id: "img1", storageKey: "recipes/org_mine/r1/a.jpg" } as never,
    ]);

    const result = await listWithUrls(prisma, "r1", actor);
    expect(result).toEqual([expect.objectContaining({ id: "img1", url: "https://signed.example/read" })]);
  });

  // The exact gap this file exists to lock in: `recipes.images` had no
  // household check at all before this fix, so any signed-in user could
  // read another household's recipe photos just by passing its id.
  it("refuses to list images for another household's recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(listWithUrls(prisma, "r1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a missing recipe as NOT_FOUND", async () => {
    prisma.recipe.findUnique.mockResolvedValue(null);

    await expect(listWithUrls(prisma, "missing", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("createUpload", () => {
  beforeEach(() => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);
  });

  it("issues a presigned URL for an allowed type and size", async () => {
    const result = await createUpload(prisma, "r1", "image/jpeg", 1024, actor);
    expect(result.uploadUrl).toBe("https://signed.example/upload");
  });

  it("rejects an unsupported content type", async () => {
    await expect(createUpload(prisma, "r1", "application/pdf", 1024, actor)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("rejects a file over the size cap", async () => {
    await expect(
      createUpload(prisma, "r1", "image/jpeg", 999_999_999, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to issue an upload URL for another household's recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(createUpload(prisma, "r1", "image/jpeg", 1024, actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("attach", () => {
  it("rejects a storage key that doesn't belong to this recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_mine" } as never);

    await expect(
      attach(prisma, "r1", "recipes/org_other/r9/a.jpg", undefined, actor)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses to attach to another household's recipe", async () => {
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(
      attach(prisma, "r1", "recipes/org_mine/r1/a.jpg", undefined, actor)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("remove", () => {
  it("refuses to remove an image belonging to another household's recipe", async () => {
    prisma.recipeImage.findUnique.mockResolvedValue({ recipeId: "r1", storageKey: "k" } as never);
    prisma.recipe.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(remove(prisma, "img1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a missing image as NOT_FOUND", async () => {
    prisma.recipeImage.findUnique.mockResolvedValue(null);

    await expect(remove(prisma, "missing", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});