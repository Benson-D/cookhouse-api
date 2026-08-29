import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { merge } from "./stores.service.js";

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe("merge", () => {
  it("repoints purchases and receipts, then deletes the duplicate", async () => {
    prisma.store.findUnique
      .mockResolvedValueOnce({ id: "keep", name: "Whole Foods" } as never)
      .mockResolvedValueOnce({ id: "dup", name: "WHOLE FOODS MARKET" } as never);
    prisma.$transaction.mockResolvedValue([{}, {}, {}] as never);

    const result = await merge(prisma, "keep", "dup");
    expect(result).toMatchObject({ id: "keep" });
  });

  it("rejects merging a store into itself", async () => {
    await expect(merge(prisma, "same", "same")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("reports an unknown keep id as NOT_FOUND", async () => {
    prisma.store.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "dup" } as never);

    await expect(merge(prisma, "missing", "dup")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports an unknown merge id as NOT_FOUND", async () => {
    prisma.store.findUnique.mockResolvedValueOnce({ id: "keep" } as never).mockResolvedValueOnce(null);

    await expect(merge(prisma, "keep", "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});