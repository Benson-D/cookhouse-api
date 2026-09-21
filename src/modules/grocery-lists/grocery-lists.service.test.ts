import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import {
  addItem,
  checkOffPurchase,
  getActive,
  removeItem,
  setCategoryOverride,
  setChecked,
} from "./grocery-lists.service.js";

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  prisma.user.findUnique.mockResolvedValue({ id: "local_1", clerkUserId: "user_1" } as never);
});

describe("checkOffPurchase", () => {
  beforeEach(() => {
    prisma.groceryList.findFirst.mockResolvedValue({ id: "list1" } as never);
    prisma.stapleReminder.findMany.mockResolvedValue([] as never);
  });

  it("checks off a matching, not-yet-checked ingredient row", async () => {
    prisma.groceryList.findUniqueOrThrow.mockResolvedValue({
      id: "list1",
      items: [{ id: "item1", ingredientId: "ing_milk", label: null, checked: false }],
    } as never);

    await checkOffPurchase(prisma, actor, { ingredientId: "ing_milk", label: null, quantity: 1 });

    expect(prisma.groceryListItem.update).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: { checked: true, checkedById: null },
    });
  });

  it("never touches a row that's already checked", async () => {
    prisma.groceryList.findUniqueOrThrow.mockResolvedValue({
      id: "list1",
      items: [{ id: "item1", ingredientId: "ing_milk", label: null, checked: true }],
    } as never);

    await checkOffPurchase(prisma, actor, { ingredientId: "ing_milk", label: null, quantity: 1 });

    expect(prisma.groceryListItem.update).not.toHaveBeenCalled();
  });

  it("matches an unrecognized item by exact, case-insensitive label text", async () => {
    prisma.groceryList.findUniqueOrThrow.mockResolvedValue({
      id: "list1",
      items: [{ id: "item1", ingredientId: null, label: "Soap", checked: false }],
    } as never);

    await checkOffPurchase(prisma, actor, { ingredientId: null, label: "soap", quantity: null });

    expect(prisma.groceryListItem.update).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: { checked: true, checkedById: null },
    });
  });

  it("creates a new already-checked row when nothing matches", async () => {
    prisma.groceryList.findUniqueOrThrow.mockResolvedValue({ id: "list1", items: [] } as never);

    await checkOffPurchase(prisma, actor, { ingredientId: "ing_new", label: null, quantity: 2 });

    expect(prisma.groceryListItem.create).toHaveBeenCalledWith({
      data: {
        listId: "list1",
        ingredientId: "ing_new",
        label: null,
        quantity: 2,
        checked: true,
        source: "receipt",
      },
    });
  });
});

describe("getActive", () => {
  it("returns the household's category overrides alongside the list", async () => {
    prisma.groceryList.findFirst.mockResolvedValue({ id: "list1" } as never);
    prisma.stapleReminder.findMany.mockResolvedValue([] as never);
    prisma.groceryList.findUniqueOrThrow.mockResolvedValue({ id: "list1", items: [] } as never);
    prisma.groceryCategoryOverride.findMany.mockResolvedValue([
      { id: "ov1", clerkOrgId: "org_mine", ingredientId: "ing_tofu", label: null, category: "protein" },
    ] as never);

    const result = await getActive(prisma, actor);

    expect(result.categoryOverrides).toEqual([
      { id: "ov1", clerkOrgId: "org_mine", ingredientId: "ing_tofu", label: null, category: "protein" },
    ]);
  });
});

describe("setCategoryOverride", () => {
  it("updates an existing override for the same ingredient", async () => {
    prisma.groceryCategoryOverride.findFirst.mockResolvedValue({ id: "ov1" } as never);
    prisma.groceryCategoryOverride.update.mockResolvedValue({} as never);

    await setCategoryOverride(prisma, actor, { ingredientId: "ing_tofu", category: "protein" });

    expect(prisma.groceryCategoryOverride.findFirst).toHaveBeenCalledWith({
      where: { clerkOrgId: "org_mine", ingredientId: "ing_tofu" },
    });
    expect(prisma.groceryCategoryOverride.update).toHaveBeenCalledWith({
      where: { id: "ov1" },
      data: { category: "protein" },
    });
    expect(prisma.groceryCategoryOverride.create).not.toHaveBeenCalled();
  });

  it("creates a new override by label when nothing exists yet", async () => {
    prisma.groceryCategoryOverride.findFirst.mockResolvedValue(null);
    prisma.groceryCategoryOverride.create.mockResolvedValue({} as never);

    await setCategoryOverride(prisma, actor, { label: "soap", category: "household" });

    expect(prisma.groceryCategoryOverride.findFirst).toHaveBeenCalledWith({
      where: { clerkOrgId: "org_mine", label: "soap" },
    });
    expect(prisma.groceryCategoryOverride.create).toHaveBeenCalledWith({
      data: {
        clerkOrgId: "org_mine",
        ingredientId: null,
        label: "soap",
        category: "household",
      },
    });
  });
});

describe("setChecked", () => {
  it("checks off an item belonging to the caller's household", async () => {
    prisma.groceryListItem.findUnique.mockResolvedValue({
      id: "i1",
      list: { clerkOrgId: "org_mine" },
    } as never);
    prisma.groceryListItem.update.mockResolvedValue({ id: "i1", checked: true } as never);

    await expect(setChecked(prisma, "i1", true, actor)).resolves.toMatchObject({ checked: true });
  });

  it("rejects checking off an item on another household's list", async () => {
    prisma.groceryListItem.findUnique.mockResolvedValue({
      id: "i1",
      list: { clerkOrgId: "org_other" },
    } as never);

    await expect(setChecked(prisma, "i1", true, actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports a missing item as NOT_FOUND", async () => {
    prisma.groceryListItem.findUnique.mockResolvedValue(null);

    await expect(setChecked(prisma, "missing", true, actor)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("removeItem", () => {
  it("removes an item belonging to the caller's household", async () => {
    prisma.groceryListItem.findUnique.mockResolvedValue({
      id: "i1",
      list: { clerkOrgId: "org_mine" },
    } as never);
    prisma.groceryListItem.delete.mockResolvedValue({} as never);

    await expect(removeItem(prisma, "i1", actor)).resolves.toEqual({ ok: true });
  });

  it("rejects removing an item on another household's list", async () => {
    prisma.groceryListItem.findUnique.mockResolvedValue({
      id: "i1",
      list: { clerkOrgId: "org_other" },
    } as never);

    await expect(removeItem(prisma, "i1", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("addItem", () => {
  beforeEach(() => {
    prisma.groceryList.findFirst.mockResolvedValue({ id: "list1" } as never);
    prisma.stapleReminder.findMany.mockResolvedValue([] as never);
    prisma.groceryListItem.findMany.mockResolvedValue([] as never);
    prisma.groceryList.findUniqueOrThrow.mockResolvedValue({ id: "list1", items: [] } as never);
    prisma.$transaction.mockResolvedValue([{}] as never);
  });

  it("merges into the matching ingredient when the typed name resolves", async () => {
    prisma.ingredientAlias.findFirst.mockResolvedValue(null);
    prisma.ingredient.findFirst.mockResolvedValue({ id: "ing_milk", name: "milk" } as never);

    await addItem(prisma, { name: "milk" }, actor);

    expect(prisma.groceryListItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ingredientId: "ing_milk" }) })
    );
  });

  it("sums to 2 when the same ingredient is added twice with no explicit quantity", async () => {
    prisma.ingredientAlias.findFirst.mockResolvedValue(null);
    prisma.ingredient.findFirst.mockResolvedValue({ id: "ing_cucumber", name: "cucumber" } as never);
    prisma.groceryListItem.findMany.mockResolvedValue([
      { id: "item1", ingredientId: "ing_cucumber", quantity: 1, unit: null },
    ] as never);

    await addItem(prisma, { name: "cucumber" }, actor);

    expect(prisma.groceryListItem.update).toHaveBeenCalledWith({
      where: { id: "item1" },
      data: { quantity: 2, unitId: null },
    });
  });

  it("stores the typed text as a label when nothing matches", async () => {
    prisma.ingredientAlias.findFirst.mockResolvedValue(null);
    prisma.ingredient.findFirst.mockResolvedValue(null);

    await addItem(prisma, { name: "soap" }, actor);

    expect(prisma.groceryListItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        listId: "list1",
        label: "soap",
        source: "manual",
        addedById: "local_1",
      }),
    });
  });
});