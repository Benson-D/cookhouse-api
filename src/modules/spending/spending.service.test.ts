import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { byCategory, byStore, topItems } from "./spending.service.js";

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

describe("byStore", () => {
  it("includes each store's own top items alongside its total", async () => {
    prisma.purchase.findMany.mockResolvedValue([
      {
        price: 10,
        label: null,
        store: { id: "s1", name: "Trader Joe's" },
        ingredient: { id: "ing_milk", name: "milk" },
      },
      {
        price: 5,
        label: null,
        store: { id: "s1", name: "Trader Joe's" },
        ingredient: { id: "ing_eggs", name: "eggs" },
      },
      { price: 3, label: "soap", store: { id: "s2", name: "Target" }, ingredient: null },
    ] as never);

    const result = await byStore(prisma, {}, actor);

    expect(result.stores).toEqual(
      expect.arrayContaining([
        {
          store: "Trader Joe's",
          storeId: "s1",
          total: 15,
          topItems: [
            { ingredientId: "ing_milk", name: "milk", total: 10, purchaseCount: 1 },
            { ingredientId: "ing_eggs", name: "eggs", total: 5, purchaseCount: 1 },
          ],
          foldedStores: null,
        },
      ])
    );
  });

  it("groups a purchase with no store under Unknown store", async () => {
    prisma.purchase.findMany.mockResolvedValue([
      { price: 4, label: "gas", store: null, ingredient: null },
    ] as never);

    const result = await byStore(prisma, {}, actor);

    expect(result.stores).toEqual([
      expect.objectContaining({ store: "Unknown store", storeId: null, total: 4 }),
    ]);
  });

  it("folds every store past the top 5 into one Other row", async () => {
    const purchases = Array.from({ length: 7 }, (_, i) => ({
      price: 10 - i,
      label: null,
      store: { id: `s${i}`, name: `Store ${i}` },
      ingredient: { id: "ing_x", name: "thing" },
    }));
    prisma.purchase.findMany.mockResolvedValue(purchases as never);

    const result = await byStore(prisma, {}, actor);

    expect(result.stores).toHaveLength(6);
    expect(result.stores[5]).toEqual({
      store: "Other",
      storeId: null,
      total: 9,
      topItems: null,
      foldedStores: [
        { store: "Store 5", total: 5 },
        { store: "Store 6", total: 4 },
      ],
    });
  });

  it("adds no Other row when there are 5 or fewer stores", async () => {
    const purchases = Array.from({ length: 5 }, (_, i) => ({
      price: 10 - i,
      label: null,
      store: { id: `s${i}`, name: `Store ${i}` },
      ingredient: { id: "ing_x", name: "thing" },
    }));
    prisma.purchase.findMany.mockResolvedValue(purchases as never);

    const result = await byStore(prisma, {}, actor);

    expect(result.stores).toHaveLength(5);
    expect(result.stores.some((s) => s.store === "Other")).toBe(false);
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
