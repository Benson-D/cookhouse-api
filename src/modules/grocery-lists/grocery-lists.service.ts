import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { mergeLines, type MergeLine, type UnitRef } from "../../lib/units.js";
import { computeFreshlyStocked, DAY_MS } from "../../lib/staples.js";
import { getOrSync } from "../users/users.service.js";
import { findOrCreateIfExactMatch } from "../ingredients/ingredients.service.js";
import { CATEGORIES } from "../../lib/categorize.js";
import type {
  AddItemInput,
  HistoryInput,
  SetCategoryOverrideInput,
} from "./grocery-lists.input.js";

type Actor = { clerkOrgId: string; clerkUserId: string };

const editorSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} satisfies Prisma.UserSelect;

const itemsInclude = {
  items: {
    include: {
      ingredient: true,
      unit: true,
      addedBy: { select: editorSelect },
      checkedBy: { select: editorSelect },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.GroceryListInclude;

/**
 * Who most recently touched the list, and when — for a "last edited by
 * JM · 4 min ago" line, not for a per-row "who" column (a shared grocery list
 * is used one-handed in a shop; per-item attribution isn't worth the space).
 *
 * Attributed to `checkedBy` over `addedBy` when both could apply, since
 * checking something off is usually the more recent, more relevant action —
 * best-effort, not a full audit trail. `checkedById` is cleared on uncheck
 * (see `setChecked`), so an item's most recent touch being an uncheck has no
 * actor to attribute it to; `at` is still accurate either way.
 */
function lastEdited(
  items: { updatedAt: Date; addedBy: EditorInfo | null; checkedBy: EditorInfo | null }[]
) {
  if (items.length === 0) return null;
  const latest = items.reduce((a, b) => (a.updatedAt > b.updatedAt ? a : b));
  return { at: latest.updatedAt, by: latest.checkedBy ?? latest.addedBy };
}

type EditorInfo = Prisma.UserGetPayload<{ select: typeof editorSelect }>;

function withLastEdited<T extends { items: Parameters<typeof lastEdited>[0] }>(
  list: T
) {
  return { ...list, lastEdited: lastEdited(list.items) };
}

/**
 * A grocery list is shared household state, so unlike recipes there is no
 * author check on writes — any member may add, check off or remove anything.
 * `addedById` / `checkedById` record who did what, but never gate it.
 */
async function getListForHousehold(
  prisma: PrismaClient,
  listId: string,
  clerkOrgId: string
) {
  const list = await prisma.groceryList.findUnique({
    where: { id: listId },
    select: { id: true, clerkOrgId: true, status: true },
  });
  if (!list || list.clerkOrgId !== clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return list;
}

/** Resolves the item's parent list and asserts it belongs to the household. */
async function getItemForHousehold(
  prisma: PrismaClient,
  itemId: string,
  clerkOrgId: string
) {
  const item = await prisma.groceryListItem.findUnique({
    where: { id: itemId },
    include: { list: { select: { clerkOrgId: true } } },
  });
  if (!item || item.list.clerkOrgId !== clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  return item;
}

/**
 * Adds any staple whose reminder has come due, and stamps `lastAddedAt`.
 *
 * Evaluated lazily here rather than on a schedule — opening the list is the
 * only moment the result is visible, so there is nothing for a cron job to do
 * that this doesn't. Staples already on the list are skipped, so reopening a
 * list twice in a day doesn't duplicate them.
 *
 * Writes: GroceryListItem, StapleReminder.lastAddedAt.
 */
async function applyDueStaples(
  prisma: PrismaClient,
  listId: string,
  clerkOrgId: string
) {
  const staples = await prisma.stapleReminder.findMany({ where: { clerkOrgId } });
  if (staples.length === 0) {
    return;
  }

  const now = Date.now();
  const due = staples.filter(
    (staple) =>
      !staple.lastAddedAt ||
      staple.lastAddedAt.getTime() + staple.frequencyDays * DAY_MS <= now
  );
  if (due.length === 0) {
    return;
  }

  // Skip staples already on the list — avoids duplicating them on repeat opens.
  const present = await prisma.groceryListItem.findMany({
    where: { listId, ingredientId: { in: due.map((s) => s.ingredientId) } },
    select: { ingredientId: true },
  });
  const alreadyOnList = new Set(present.map((item) => item.ingredientId));
  const toAdd = due.filter((staple) => !alreadyOnList.has(staple.ingredientId));

  // Add the new staple rows and reset the reminder clock, together.
  await prisma.$transaction([
    ...toAdd.map((staple) =>
      prisma.groceryListItem.create({
        data: { listId, ingredientId: staple.ingredientId, source: "staple" },
      })
    ),
    prisma.stapleReminder.updateMany({
      where: { id: { in: due.map((s) => s.id) } },
      data: { lastAddedAt: new Date(now) },
    }),
  ]);
}

/**
 * Folds new lines into a list, leaving exactly one row per ingredient.
 *
 * Existing rows are reused rather than replaced, so a checked-off item keeps
 * its state and its `addedBy`. Where a merge collapses several existing rows
 * into one — which happens to lists built before this rule, or when a manual
 * entry meets a recipe's — the first row is updated and the rest deleted.
 *
 * Writes: GroceryListItem (create, update and delete), all in one transaction.
 */
async function mergeIntoList(
  prisma: PrismaClient,
  listId: string,
  incoming: Array<{ ingredientId: string; quantity: number | null; unit: UnitRef }>,
  source: string,
  userId: string,
  freshlyStocked: Set<string> = new Set()
) {
  const current = await prisma.groceryListItem.findMany({
    where: { listId },
    include: { unit: true },
    orderBy: { createdAt: "asc" },
  });

  // A label-only row has no ingredientId to merge on — it never participates
  // in this computation at all, unlike every other row here.
  const existingLines: MergeLine<string | null>[] = current
    .filter((item): item is typeof item & { ingredientId: string } => item.ingredientId !== null)
    .map((item) => ({
      ingredientId: item.ingredientId,
      quantity: item.quantity,
      unit: item.unit,
      meta: item.id,
    }));
  const incomingLines: MergeLine<string | null>[] = incoming.map((line) => ({
    ...line,
    meta: null,
  }));

  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const line of mergeLines([...existingLines, ...incomingLines])) {
    const rowIds = line.sources.filter((id): id is string => id !== null);
    const [keep, ...redundant] = rowIds;

    if (keep === undefined) {
      operations.push(
        prisma.groceryListItem.create({
          data: {
            listId,
            ingredientId: line.ingredientId,
            unitId: line.unit?.id,
            quantity: line.quantity,
            source,
            addedById: userId,
            checked: freshlyStocked.has(line.ingredientId),
          },
        })
      );
      continue;
    }

    operations.push(
      prisma.groceryListItem.update({
        where: { id: keep },
        data: { quantity: line.quantity, unitId: line.unit?.id ?? null },
      })
    );
    if (redundant.length > 0) {
      operations.push(
        prisma.groceryListItem.deleteMany({ where: { id: { in: redundant } } })
      );
    }
  }

  await prisma.$transaction(operations);
}

/**
 * The household's current list, created on first access, plus its category
 * overrides — returned together so the frontend gets everything it needs
 * from one query rather than a second round trip.
 *
 * This is what enforces "exactly one active list per household" — every
 * caller gets the active list through here, which finds one or creates it,
 * rather than ever creating one directly.
 *
 * Writes: GroceryList (first access), plus anything applyDueStaples adds.
 */
export async function getActive(prisma: PrismaClient, actor: Actor) {
  const existing = await prisma.groceryList.findFirst({
    where: { clerkOrgId: actor.clerkOrgId, status: "active" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  // No active list yet — create a new, empty one.
  const listId =
    existing?.id ??
    (await prisma.groceryList.create({ data: { clerkOrgId: actor.clerkOrgId } }))
      .id;

  await applyDueStaples(prisma, listId, actor.clerkOrgId);

  // Fetched together — one round trip for the frontend instead of two.
  const [list, categoryOverrides] = await Promise.all([
    prisma.groceryList.findUniqueOrThrow({
      where: { id: listId },
      include: itemsInclude,
    }),
    prisma.groceryCategoryOverride.findMany({ where: { clerkOrgId: actor.clerkOrgId } }),
  ]);
  return { ...withLastEdited(list), categoryOverrides };
}

/**
 * Of the given ingredient ids, returns the subset that are household staples
 * the household was last checked off within their own `frequencyDays` — i.e.
 * "you probably still have this."
 *
 * Deliberately keyed off a *checked-off item on a completed list*, not
 * `StapleReminder.lastAddedAt` (that only means "we last reminded you," not
 * "you actually bought it") and not `Purchase` (only populated by receipt
 * scanning, so a household that never scans receipts would never benefit,
 * and OCR'd line items are matched against noisy brand-name text — a
 * checked-off list row is tied to the canonical `Ingredient` id directly, no
 * fuzzy matching involved). A completed list's checked items are frozen once
 * the list moves out of `active` status, so `updatedAt` reliably reflects
 * when it was checked, not some later unrelated edit.
 */
async function getFreshlyStockedStaples(
  prisma: PrismaClient,
  clerkOrgId: string,
  ingredientIds: string[]
): Promise<Set<string>> {
  if (ingredientIds.length === 0) return new Set();

  const staples = await prisma.stapleReminder.findMany({
    where: { clerkOrgId, ingredientId: { in: ingredientIds } },
    select: { ingredientId: true, frequencyDays: true },
  });
  if (staples.length === 0) return new Set();

  const lastChecked = await prisma.groceryListItem.findMany({
    where: {
      ingredientId: { in: staples.map((s) => s.ingredientId) },
      checked: true,
      list: { clerkOrgId, status: "completed" },
    },
    orderBy: { updatedAt: "desc" },
    select: { ingredientId: true, updatedAt: true },
  });

  const mostRecentByIngredient = new Map<string, Date>();
  for (const item of lastChecked) {
    // The where clause above only ever matches a real ingredientId — this is
    // just satisfying the column's own nullable type.
    if (item.ingredientId && !mostRecentByIngredient.has(item.ingredientId)) {
      mostRecentByIngredient.set(item.ingredientId, item.updatedAt);
    }
  }

  return computeFreshlyStocked(staples, mostRecentByIngredient, Date.now());
}

/**
 * Adds every ingredient from the given recipes to the active list, merged.
 *
 * Recipe lines are merged against each other *and* against what is already on
 * the list, so adding two recipes that both call for flour produces one line.
 * Merging happens per (ingredient, unit family) — see lib/units.ts.
 *
 * A line whose ingredient is a staple the household was recently checked off
 * for (see `getFreshlyStockedStaples`) still gets added — so the recipe's
 * full ingredient list stays visible — but pre-checked, distinguishable from
 * a person's own checkoff by having no `checkedById`. Only applies to a
 * brand-new row: `mergeIntoList` never touches the checked state of a row
 * that already exists, so this can't flip something a person already
 * unchecked back on.
 *
 * Note this is lossy by design: `GroceryListItem` records no link back to the
 * recipe it came from, so "remove this recipe's contribution" is not
 * expressible afterwards.
 *
 * Writes: GroceryList (if none active), GroceryListItem.
 * Throws NOT_FOUND if any recipe id is missing or owned by another household.
 */
export async function addFromRecipes(
  prisma: PrismaClient,
  recipeIds: string[],
  actor: Actor
) {
  const recipes = await prisma.recipe.findMany({
    where: { id: { in: recipeIds }, clerkOrgId: actor.clerkOrgId },
    include: { ingredients: { include: { unit: true } } },
  });
  if (recipes.length !== recipeIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Unknown recipe" });
  }

  const list = await getActive(prisma, actor);
  const user = await getOrSync(prisma, actor.clerkUserId);

  const lines = recipes.flatMap((recipe) =>
    recipe.ingredients.map((line) => ({
      ingredientId: line.ingredientId,
      quantity: line.amount,
      unit: line.unit,
    }))
  );
  const freshlyStocked = await getFreshlyStockedStaples(
    prisma,
    actor.clerkOrgId,
    [...new Set(lines.map((line) => line.ingredientId))]
  );

  await mergeIntoList(prisma, list.id, lines, "recipe", user.id, freshlyStocked);

  const updated = await prisma.groceryList.findUniqueOrThrow({
    where: { id: list.id },
    include: itemsInclude,
  });
  return withLastEdited(updated);
}

/**
 * Adds one manually-entered item to the active list, by typed name. A miss
 * only creates a new `Ingredient` when the name exactly matches a category
 * keyword; otherwise stores the typed text as a lowercased `label`.
 *
 * Writes: GroceryList (if none active), GroceryListItem, User (first request),
 * Ingredient (only when genuinely new and an exact keyword match).
 * Throws NOT_FOUND if the unit id is unknown.
 */
export async function addItem(
  prisma: PrismaClient,
  input: AddItemInput,
  actor: Actor
) {
  const list = await getActive(prisma, actor);
  const user = await getOrSync(prisma, actor.clerkUserId);

  const unit = input.unitId
    ? await prisma.measurementUnit.findUnique({ where: { id: input.unitId } })
    : null;
  if (input.unitId && !unit) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Unknown unit" });
  }

  const ingredient = await findOrCreateIfExactMatch(prisma, input.name);

  if (ingredient) {
    // Defaults to 1, not null — a null quantity never accumulates on merge.
    await mergeIntoList(
      prisma,
      list.id,
      [{ ingredientId: ingredient.id, quantity: input.quantity ?? 1, unit }],
      "manual",
      user.id
    );
  } else {
    await prisma.groceryListItem.create({
      data: {
        listId: list.id,
        label: input.name.trim().toLowerCase(),
        unitId: unit?.id,
        quantity: input.quantity ?? null,
        source: "manual",
        addedById: user.id,
      },
    });
  }

  const updated = await prisma.groceryList.findUniqueOrThrow({
    where: { id: list.id },
    include: itemsInclude,
  });
  return withLastEdited(updated);
}

/**
 * Reconciles one confirmed purchase against the active list: checks off a
 * matching row, or adds a new already-checked one if it wasn't on the list
 * at all. Matching is exact only — by `ingredientId` when the purchase
 * resolved to a real ingredient, by case-insensitive `label` text when it
 * didn't (no fuzzy matching, same as every other matching step in this app).
 *
 * Never touches a row that's already checked — this can't overwrite a real
 * person's own check-off with a system one.
 *
 * Writes: GroceryList (if none active), GroceryListItem.
 */
export async function checkOffPurchase(
  prisma: PrismaClient,
  actor: Actor,
  purchase: { ingredientId: string | null; label: string | null; quantity: number | null }
) {
  const list = await getActive(prisma, actor);

  const match = list.items.find((item) =>
    purchase.ingredientId
      ? item.ingredientId === purchase.ingredientId
      : item.label?.toLowerCase() === purchase.label?.toLowerCase()
  );

  if (match) {
    if (!match.checked) {
      await prisma.groceryListItem.update({
        where: { id: match.id },
        data: { checked: true, checkedById: null },
      });
    }
    return;
  }

  await prisma.groceryListItem.create({
    data: {
      listId: list.id,
      ingredientId: purchase.ingredientId,
      label: purchase.label,
      quantity: purchase.quantity,
      checked: true,
      source: "receipt",
    },
  });
}

/**
 * Sets a household's own category for an ingredient (or an unrecognized
 * item, by label) — never touches the shared, global Ingredient.category.
 * Find-existing-then-update-or-create, scoped to the household; no DB-level
 * unique constraint, same shape as this app's other service-enforced
 * invariants. No separate "clear" action — setting a new value is the only
 * write this needs.
 *
 * Writes: GroceryCategoryOverride.
 */
export async function setCategoryOverride(
  prisma: PrismaClient,
  actor: Actor,
  input: SetCategoryOverrideInput
) {
  const where = input.ingredientId
    ? { clerkOrgId: actor.clerkOrgId, ingredientId: input.ingredientId }
    : { clerkOrgId: actor.clerkOrgId, label: input.label };

  const existing = await prisma.groceryCategoryOverride.findFirst({ where });

  if (existing) {
    return prisma.groceryCategoryOverride.update({
      where: { id: existing.id },
      data: { category: input.category },
    });
  }

  return prisma.groceryCategoryOverride.create({
    data: {
      clerkOrgId: actor.clerkOrgId,
      ingredientId: input.ingredientId ?? null,
      label: input.label ?? null,
      category: input.category,
    },
  });
}

/**
 * Every raw category value `categorize()` knows about, for the override
 * picker — grouping or display labels (e.g. combining "meat" and "seafood"
 * into one section) are a presentational call, left to the frontend, same
 * as how a `GroceryListItem.source` value gets formatted for display there.
 */
export function categories(): string[] {
  return Object.keys(CATEGORIES);
}

/**
 * Checks or unchecks an item, recording who did it.
 *
 * Writes: GroceryListItem (checked, checkedById), User (first request).
 * `checkedById` is cleared on uncheck so it never names someone for a state
 * that is no longer true.
 * Throws NOT_FOUND if the item belongs to another household.
 */
export async function setChecked(
  prisma: PrismaClient,
  itemId: string,
  checked: boolean,
  actor: Actor
) {
  await getItemForHousehold(prisma, itemId, actor.clerkOrgId);
  const user = checked ? await getOrSync(prisma, actor.clerkUserId) : null;

  return prisma.groceryListItem.update({
    where: { id: itemId },
    data: { checked, checkedById: user?.id ?? null },
  });
}

/**
 * Writes: GroceryListItem (delete).
 * Throws NOT_FOUND if the item belongs to another household.
 */
export async function removeItem(
  prisma: PrismaClient,
  itemId: string,
  actor: Actor
) {
  await getItemForHousehold(prisma, itemId, actor.clerkOrgId);
  await prisma.groceryListItem.delete({ where: { id: itemId } });
  return { ok: true };
}

/**
 * Archives the active list. The next `getActive` starts a fresh one.
 *
 * Completed lists are kept, not cleared — browsing "last week's list" is a
 * deliberate feature (see CLAUDE.md), which is why this flips a status rather
 * than deleting rows.
 *
 * Writes: GroceryList.status.
 * Throws NOT_FOUND if the household has no active list.
 */
export async function complete(prisma: PrismaClient, actor: Actor) {
  const active = await prisma.groceryList.findFirst({
    where: { clerkOrgId: actor.clerkOrgId, status: "active" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!active) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No active list" });
  }

  const completed = await prisma.groceryList.update({
    where: { id: active.id },
    data: { status: "completed" },
    include: itemsInclude,
  });
  return withLastEdited(completed);
}

/**
 * Deletes every item on the active list but leaves the list itself active —
 * distinct from `complete`, which archives it. For "this was built from the
 * wrong recipes, start over," not "we're done shopping."
 *
 * Writes: GroceryListItem (delete all for this list).
 * Throws NOT_FOUND if the household has no active list.
 */
export async function removeAll(prisma: PrismaClient, actor: Actor) {
  const active = await prisma.groceryList.findFirst({
    where: { clerkOrgId: actor.clerkOrgId, status: "active" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!active) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No active list" });
  }

  await prisma.groceryListItem.deleteMany({ where: { listId: active.id } });

  const cleared = await prisma.groceryList.findUniqueOrThrow({
    where: { id: active.id },
    include: itemsInclude,
  });
  return withLastEdited(cleared);
}

/** A page of archived lists, newest first, with the total for pagination. */
export async function history(
  prisma: PrismaClient,
  filters: HistoryInput,
  actor: Actor
) {
  const where: Prisma.GroceryListWhereInput = {
    clerkOrgId: actor.clerkOrgId,
    status: "completed",
  };

  const [lists, total] = await prisma.$transaction([
    prisma.groceryList.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: itemsInclude,
      skip: filters.skip,
      take: filters.take,
    }),
    prisma.groceryList.count({ where }),
  ]);

  return { lists: lists.map(withLastEdited), total, ...filters };
}

export { getListForHousehold };
