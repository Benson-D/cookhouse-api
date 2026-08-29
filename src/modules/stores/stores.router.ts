import { adminProcedure, router } from "../../trpc.js";
import { mergeStoresInput } from "./stores.input.js";
import * as stores from "./stores.service.js";

/**
 * Store is global reference data shared across every household, like Tag —
 * so listing and merging duplicates is admin-only, same reasoning as
 * tags.create/delete.
 */
export const storesRouter = router({
  list: adminProcedure.query(({ ctx }) => stores.list(ctx.prisma)),

  merge: adminProcedure
    .input(mergeStoresInput)
    .mutation(({ ctx, input }) => stores.merge(ctx.prisma, input.keepId, input.mergeId)),
});