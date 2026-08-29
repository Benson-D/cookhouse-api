import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";

vi.mock("../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/storage.js")>();
  return {
    ...actual,
    createReadUrl: vi.fn().mockResolvedValue("https://signed.example/receipt.jpg"),
    deleteObject: vi.fn().mockResolvedValue(undefined),
  };
});

const { getById, remove } = await import("./receipts.service.js");

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe("getById", () => {
  it("returns a receipt belonging to the caller's household", async () => {
    prisma.receipt.findUnique.mockResolvedValue({
      id: "rc1",
      clerkOrgId: "org_mine",
      imageS3Key: "key",
    } as never);

    const result = await getById(prisma, "rc1", actor);
    expect(result.imageUrl).toBe("https://signed.example/receipt.jpg");
  });

  it("reports another household's receipt as NOT_FOUND", async () => {
    prisma.receipt.findUnique.mockResolvedValue({ id: "rc1", clerkOrgId: "org_other" } as never);

    await expect(getById(prisma, "rc1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a missing receipt as NOT_FOUND", async () => {
    prisma.receipt.findUnique.mockResolvedValue(null);

    await expect(getById(prisma, "missing", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("remove", () => {
  it("deletes a receipt belonging to the caller's household", async () => {
    prisma.receipt.findUnique.mockResolvedValue({
      clerkOrgId: "org_mine",
      imageS3Key: "key",
    } as never);
    prisma.$transaction.mockResolvedValue([{}, {}] as never);

    await expect(remove(prisma, "rc1", actor)).resolves.toEqual({ ok: true });
  });

  it("rejects deleting another household's receipt", async () => {
    prisma.receipt.findUnique.mockResolvedValue({ clerkOrgId: "org_other" } as never);

    await expect(remove(prisma, "rc1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});