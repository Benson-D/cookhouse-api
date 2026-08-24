import type { Prisma, PrismaClient } from "@prisma/client";
import type { DateRangeInput, FiltersInput, TopItemsInput } from "./spending.input.js";

type Actor = { clerkOrgId: string; clerkUserId: string };

/** Start of the current calendar month, local server time. */
function startOfThisMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** `from` defaults to the start of this month, `to` to now — a "this month so far" window. */
function resolveMonthRange(input: DateRangeInput) {
  return { from: input.from ?? startOfThisMonth(), to: input.to ?? new Date() };
}

/** `trend`'s default window is longer — one month has nothing to trend against. */
function resolveTrendRange(input: DateRangeInput) {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  return { from: input.from ?? sixMonthsAgo, to: input.to ?? now };
}

/**
 * The `where` clause every report shares: household + date range, plus
 * whichever of store/category/user the caller narrowed to. Centralized so
 * the five report functions below can't drift on how a filter gets applied.
 */
function buildWhere(
  clerkOrgId: string,
  range: { from: Date; to: Date },
  filters: FiltersInput
): Prisma.PurchaseWhereInput {
  return {
    clerkOrgId,
    purchasedAt: { gte: range.from, lte: range.to },
    ...(filters.storeId ? { storeId: filters.storeId } : {}),
    ...(filters.category ? { ingredient: { category: filters.category } } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
  };
}

/**
 * Total spend and purchase count for the range — the headline number.
 *
 * Aggregates in Postgres (`_sum`/`_count`) rather than fetching rows, since
 * this doesn't need the individual purchases, only the totals.
 */
export async function summary(
  prisma: PrismaClient,
  input: DateRangeInput & FiltersInput,
  actor: Actor
) {
  const range = resolveMonthRange(input);
  const where = buildWhere(actor.clerkOrgId, range, input);

  const result = await prisma.purchase.aggregate({ where, _sum: { price: true }, _count: true });

  return { ...range, total: result._sum.price ?? 0, purchaseCount: result._count };
}

/**
 * Spend grouped by `Ingredient.category` — answers "where's the money going"
 * (produce vs. pantry vs. dairy...), not just how much overall.
 *
 * Grouping crosses a relation (`Purchase` → `Ingredient.category`), which
 * Prisma's `groupBy` can't do directly, so this fetches the (small,
 * date-bounded) row set and reduces in memory rather than reaching for raw
 * SQL — fine at this app's scale, and it keeps the query plain Prisma.
 * Uncategorized ingredients (`category: null`) group under "Uncategorized"
 * rather than being dropped, so nothing silently vanishes from the total.
 */
export async function byCategory(
  prisma: PrismaClient,
  input: DateRangeInput & Omit<FiltersInput, "category">,
  actor: Actor
) {
  const range = resolveMonthRange(input);
  const where = buildWhere(actor.clerkOrgId, range, input);

  const purchases = await prisma.purchase.findMany({
    where,
    select: { price: true, ingredient: { select: { category: true } } },
  });

  const totals = new Map<string, number>();
  for (const purchase of purchases) {
    const category = purchase.ingredient.category ?? "Uncategorized";
    totals.set(category, (totals.get(category) ?? 0) + purchase.price);
  }

  return {
    ...range,
    categories: [...totals.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * Spend grouped by store. Same reduce-in-memory approach as `byCategory`, and
 * the same reasoning for why: small, date-bounded row set, no raw SQL needed.
 *
 * `storeId` is nullable (a manually-entered purchase, or a receipt with no
 * detected vendor) — those group under "Unknown store" rather than being
 * dropped, matching how a grocery line with no quantity still shows the
 * ingredient rather than disappearing (see root CLAUDE.md's domain rules).
 */
export async function byStore(
  prisma: PrismaClient,
  input: DateRangeInput & Omit<FiltersInput, "storeId">,
  actor: Actor
) {
  const range = resolveMonthRange(input);
  const where = buildWhere(actor.clerkOrgId, range, input);

  const purchases = await prisma.purchase.findMany({
    where,
    select: { price: true, store: { select: { name: true } } },
  });

  const totals = new Map<string, number>();
  for (const purchase of purchases) {
    const store = purchase.store?.name ?? "Unknown store";
    totals.set(store, (totals.get(store) ?? 0) + purchase.price);
  }

  return {
    ...range,
    stores: [...totals.entries()]
      .map(([store, total]) => ({ store, total }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * Spend per calendar month over the range — shaped for a chart plus a table
 * of exact figures alongside it. Every month in the range appears even with
 * zero spend, so a chart doesn't silently skip a quiet month.
 */
export async function trend(
  prisma: PrismaClient,
  input: DateRangeInput & FiltersInput,
  actor: Actor
) {
  const range = resolveTrendRange(input);
  const where = buildWhere(actor.clerkOrgId, range, input);

  const purchases = await prisma.purchase.findMany({
    where,
    select: { price: true, purchasedAt: true },
  });

  const monthKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

  const totals = new Map<string, number>();
  for (const purchase of purchases) {
    const key = monthKey(purchase.purchasedAt);
    totals.set(key, (totals.get(key) ?? 0) + purchase.price);
  }

  // Walk every month in the range, not just the ones with purchases.
  const months: { month: string; total: number }[] = [];
  const cursor = new Date(range.from.getFullYear(), range.from.getMonth(), 1);
  const end = new Date(range.to.getFullYear(), range.to.getMonth(), 1);
  while (cursor <= end) {
    const key = monthKey(cursor);
    months.push({ month: key, total: totals.get(key) ?? 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return { ...range, months };
}

/**
 * Top ingredients by spend for a range — the drill-down behind tapping a
 * point on the trend chart. Deliberately its own on-demand query rather than
 * baked into `trend`'s response: the chart needs to stay cheap and always
 * loaded, while this only costs anything when someone actually taps a month.
 */
export async function topItems(prisma: PrismaClient, input: TopItemsInput, actor: Actor) {
  const range = resolveMonthRange(input);
  const where = buildWhere(actor.clerkOrgId, range, input);

  const purchases = await prisma.purchase.findMany({
    where,
    select: { price: true, ingredient: { select: { id: true, name: true } } },
  });

  const totals = new Map<string, { name: string; total: number; purchaseCount: number }>();
  for (const purchase of purchases) {
    const existing = totals.get(purchase.ingredient.id);
    if (existing) {
      existing.total += purchase.price;
      existing.purchaseCount += 1;
    } else {
      totals.set(purchase.ingredient.id, {
        name: purchase.ingredient.name,
        total: purchase.price,
        purchaseCount: 1,
      });
    }
  }

  return {
    ...range,
    items: [...totals.entries()]
      .map(([ingredientId, value]) => ({ ingredientId, ...value }))
      .sort((a, b) => b.total - a.total)
      .slice(0, input.limit),
  };
}
