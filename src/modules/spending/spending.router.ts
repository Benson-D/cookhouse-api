import { householdProcedure, router } from "../../trpc.js";
import {
  byCategoryInput,
  byStoreInput,
  summaryInput,
  topItemsInput,
  trendInput,
} from "./spending.input.js";
import * as spending from "./spending.service.js";

/**
 * Read-only reports over `Purchase` — nothing here writes. Purchases
 * themselves come from `receipts.confirmPurchases` or, eventually, manual
 * entry; this module only ever reads what already exists.
 */
export const spendingRouter = router({
  /** Total spent and purchase count for the range — defaults to this month so far. */
  summary: householdProcedure
    .input(summaryInput)
    .query(({ ctx, input }) => spending.summary(ctx.prisma, input, ctx)),

  /** Spend by Ingredient.category — defaults to this month so far. */
  byCategory: householdProcedure
    .input(byCategoryInput)
    .query(({ ctx, input }) => spending.byCategory(ctx.prisma, input, ctx)),

  /** Spend by store — defaults to this month so far. */
  byStore: householdProcedure
    .input(byStoreInput)
    .query(({ ctx, input }) => spending.byStore(ctx.prisma, input, ctx)),

  /** Spend per month — defaults to the last 6 months. */
  trend: householdProcedure
    .input(trendInput)
    .query(({ ctx, input }) => spending.trend(ctx.prisma, input, ctx)),

  /** Top ingredients by spend for a range — the trend chart's drill-down. */
  topItems: householdProcedure
    .input(topItemsInput)
    .query(({ ctx, input }) => spending.topItems(ctx.prisma, input, ctx)),
});
