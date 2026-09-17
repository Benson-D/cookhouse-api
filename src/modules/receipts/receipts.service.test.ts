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

const { confirmPurchases, getById, remove } = await import("./receipts.service.js");

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe("confirmPurchases", () => {
  beforeEach(() => {
    prisma.receipt.findUnique.mockResolvedValue({ id: "rc1", clerkOrgId: "org_mine" } as never);
    prisma.user.findUnique.mockResolvedValue({ id: "local_1" } as never);
    prisma.purchase.create.mockResolvedValue({} as never);
  });

  it("uses the matching ingredient when the description resolves", async () => {
    prisma.ingredientAlias.findFirst.mockResolvedValue(null);
    prisma.ingredient.findFirst.mockResolvedValue({ id: "ing_milk", name: "milk" } as never);

    await confirmPurchases(
      prisma,
      { receiptId: "rc1", items: [{ description: "milk", price: 3.5 }] },
      actor
    );

    expect(prisma.purchase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ingredientId: "ing_milk", label: null }),
      })
    );
    expect(prisma.ingredient.upsert).not.toHaveBeenCalled();
  });

  it("creates a real ingredient when categorize() confidently recognizes it", async () => {
    prisma.ingredientAlias.findFirst.mockResolvedValue(null);
    prisma.ingredient.findFirst.mockResolvedValue(null);
    prisma.ingredient.upsert.mockResolvedValue({ id: "ing_new", name: "kombucha" } as never);

    await confirmPurchases(
      prisma,
      { receiptId: "rc1", items: [{ description: "kombucha", price: 4 }] },
      actor
    );

    expect(prisma.ingredient.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { name: "kombucha", category: "beverages" },
      })
    );
    expect(prisma.purchase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ingredientId: "ing_new", label: null }),
      })
    );
  });

  it("stores an unrecognized item as a label instead of inventing an ingredient", async () => {
    prisma.ingredientAlias.findFirst.mockResolvedValue(null);
    prisma.ingredient.findFirst.mockResolvedValue(null);

    await confirmPurchases(
      prisma,
      { receiptId: "rc1", items: [{ description: "GV WHL MLK 2Z", price: 2 }] },
      actor
    );

    expect(prisma.ingredient.upsert).not.toHaveBeenCalled();
    expect(prisma.purchase.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ ingredientId: null, label: "GV WHL MLK 2Z" }),
      })
    );
  });
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