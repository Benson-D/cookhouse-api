import { adminProcedure, protectedProcedure, router } from "../../trpc.js";
import { mergeStoresInput, searchStoresInput } from "./stores.input.js";
import * as stores from "./stores.service.js";

/**
 * Store is global reference data shared across every household, like
 * Ingredient and Tag. Searching it is open to any signed-in user — the
 * receipt review screen's store picker — but `list` (which exposes
 * purchase/receipt counts across every household) and merging duplicates
 * stay admin-only, same reasoning as tags.create/delete.
 */
export const storesRouter = router({
  list: adminProcedure.query(({ ctx }) => stores.list(ctx.prisma)),

  /** Search stores by name (id + name only) — for the receipt store picker. */
  search: protectedProcedure
    .input(searchStoresInput)
    .query(({ ctx, input }) => stores.search(ctx.prisma, input.search, input.take)),

  merge: adminProcedure
    .input(mergeStoresInput)
    .mutation(({ ctx, input }) => stores.merge(ctx.prisma, input.keepId, input.mergeId)),
});