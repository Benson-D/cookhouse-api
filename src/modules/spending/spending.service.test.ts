import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { byCategory, topItems } from "./spending.service.js";

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
});

describe("byCategory", () => {
  it("buckets a label-only purchase (no ingredient) under Uncategorized", async () => {
    prisma.purchase.findMany.mockResolvedValue([
      { price: 5, ingredient: { category: "produce" } },
      { price: 3, ingredient: null },
    ] as never);

    const result = await byCategory(prisma, {}, actor);

    expect(result.categories).toEqual(
      expect.arrayContaining([
        { category: "produce", total: 5 },
        { category: "Uncategorized", total: 3 },
      ])
    );
  });
});

describe("topItems", () => {
  it("groups repeat label-only purchases by their shared label text", async () => {
    prisma.purchase.findMany.mockResolvedValue([
      { price: 2, label: "soap", ingredient: null },
      { price: 3, label: "soap", ingredient: null },
      { price: 4, label: null, ingredient: { id: "ing_milk", name: "milk" } },
    ] as never);

    const result = await topItems(prisma, { limit: 10 }, actor);

    expect(result.items).toEqual(
      expect.arrayContaining([
        { ingredientId: null, name: "soap", total: 5, purchaseCount: 2 },
        { ingredientId: "ing_milk", name: "milk", total: 4, purchaseCount: 1 },
      ])
    );
  });
});
