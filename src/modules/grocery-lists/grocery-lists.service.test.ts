import { beforeEach, describe, expect, it } from "vitest";
import { mockDeep, type DeepMockProxy } from "vitest-mock-extended";
import type { PrismaClient } from "@prisma/client";
import { removeItem, setChecked } from "./grocery-lists.service.js";

const actor = { clerkOrgId: "org_mine", clerkUserId: "user_1" };

let prisma: DeepMockProxy<PrismaClient>;

beforeEach(() => {
  prisma = mockDeep<PrismaClient>();
  prisma.user.findUnique.mockResolvedValue({ id: "local_1", clerkUserId: "user_1" } as never);
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