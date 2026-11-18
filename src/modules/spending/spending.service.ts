import type { Prisma, PrismaClient } from "@prisma/client";
import type { DateRangeInput, FiltersInput, TopItemsInput, TrendInput } from "./spending.input.js";

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
    const category = purchase.ingredient?.category ?? "Uncategorized";
    totals.set(category, (totals.get(category) ?? 0) + purchase.price);
  }

  return {
    ...range,
    categories: [...totals.entries()]
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total),
  };
}

const TOP_STORE_COUNT = 5;
const TOP_ITEMS_PER_STORE = 5;

type ItemTotal = { ingredientId: string | null; name: string; total: number; purchaseCount: number };

type StoreSpendRow = {
  store: string;
  storeId: string | null;
  total: number;
  topItems: ItemTotal[] | null;
  foldedStores: { store: string; total: number }[] | null;
};

/**
 * Spend grouped by store, ranked and capped to the top 5 plus one "Other"
 * row folding the rest — each of the 5 also carries its own top 5 items, for
 * a hover tooltip, so the chart never needs a second per-store query.
 *
 * `storeId` is nullable (a manually-entered purchase, or a receipt with no
 * detected vendor) — those group under "Unknown store" rather than being
 * dropped, matching how a grocery line with no quantity still shows the
 * ingredient rather than disappearing.
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
    select: {
      price: true,
      label: true,
      store: { select: { id: true, name: true } },
      ingredient: { select: { id: true, name: true } },
    },
  });

  const storeGroups = new Map<
    string,
    { storeId: string | null; store: string; total: number; items: Map<string, ItemTotal> }
  >();

  for (const purchase of purchases) {
    const storeKey = purchase.store?.id ?? "unknown";
    let group = storeGroups.get(storeKey);
    if (!group) {
      group = {
        storeId: purchase.store?.id ?? null,
        store: purchase.store?.name ?? "Unknown store",
        total: 0,
        items: new Map(),
      };
      storeGroups.set(storeKey, group);
    }
    group.total += purchase.price;

    const itemKey = purchase.ingredient?.id ?? `label:${purchase.label}`;
    const existingItem = group.items.get(itemKey);
    if (existingItem) {
      existingItem.total += purchase.price;
      existingItem.purchaseCount += 1;
    } else {
      group.items.set(itemKey, {
        ingredientId: purchase.ingredient?.id ?? null,
        name: purchase.ingredient?.name ?? purchase.label ?? "Unknown",
        total: purchase.price,
        purchaseCount: 1,
      });
    }
  }

  const sortedStores = [...storeGroups.values()].sort((a, b) => b.total - a.total);
  const topStores = sortedStores.slice(0, TOP_STORE_COUNT);
  const remainingStores = sortedStores.slice(TOP_STORE_COUNT);

  const stores: StoreSpendRow[] = topStores.map((group) => ({
    store: group.store,
    storeId: group.storeId,
    total: group.total,
    topItems: [...group.items.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, TOP_ITEMS_PER_STORE),
    foldedStores: null,
  }));

  if (remainingStores.length > 0) {
    stores.push({
      store: "Other",
      storeId: null,
      total: remainingStores.reduce((sum, group) => sum + group.total, 0),
      topItems: null,
      foldedStores: remainingStores.map((group) => ({ store: group.store, total: group.total })),
    });
  }

  return { ...range, stores };
}

/** `date`'s year-month in `timeZone`, so a late-night purchase doesn't roll into the server's next day. */
function monthKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

/** Falls back to UTC on an invalid IANA zone rather than letting it throw mid-request. */
function resolveTimeZone(timezone: string | undefined): string {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return "UTC";
  }
}

/**
 * Spend per calendar month over the range — shaped for a chart plus a table
 * of exact figures alongside it. Every month in the range appears even with
 * zero spend, so a chart doesn't silently skip a quiet month.
 */
export async function trend(prisma: PrismaClient, input: TrendInput, actor: Actor) {
  const range = resolveTrendRange(input);
  const where = buildWhere(actor.clerkOrgId, range, input);
  const timeZone = resolveTimeZone(input.timezone);

  const purchases = await prisma.purchase.findMany({
    where,
    select: { price: true, purchasedAt: true },
  });

  const totals = new Map<string, number>();
  for (const purchase of purchases) {
    const key = monthKey(purchase.purchasedAt, timeZone);
    totals.set(key, (totals.get(key) ?? 0) + purchase.price);
  }

  // Walk every month in the range as plain year/month integers, not Date
  // math — Date's own getFullYear/getMonth read the server's timezone,
  // which would undo the point of bucketing by the caller's instead.
  const [fromYear, fromMonth] = monthKey(range.from, timeZone).split("-").map(Number);
  const [toYear, toMonth] = monthKey(range.to, timeZone).split("-").map(Number);

  const months: { month: string; total: number }[] = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    months.push({ month: key, total: totals.get(key) ?? 0 });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
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
    select: { price: true, label: true, ingredient: { select: { id: true, name: true } } },
  });

  const totals = new Map<
    string,
    { ingredientId: string | null; name: string; total: number; purchaseCount: number }
  >();
  for (const purchase of purchases) {
    // A label-only purchase has no ingredient to group by — its own label
    // text stands in as the grouping key, so repeat purchases of the same
    // unrecognized item (say, a store's own "soap" line) still total
    // together. The key is only ever used to group; the real (possibly
    // null) ingredientId is what actually gets returned.
    const key = purchase.ingredient?.id ?? `label:${purchase.label}`;
    const name = purchase.ingredient?.name ?? purchase.label ?? "Unknown";

    const existing = totals.get(key);
    if (existing) {
      existing.total += purchase.price;
      existing.purchaseCount += 1;
    } else {
      totals.set(key, {
        ingredientId: purchase.ingredient?.id ?? null,
        name,
        total: purchase.price,
        purchaseCount: 1,
      });
    }
  }

  return {
    ...range,
    items: [...totals.values()].sort((a, b) => b.total - a.total).slice(0, input.limit),
  };
}
