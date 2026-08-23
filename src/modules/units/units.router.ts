import { protectedProcedure, router } from "../../trpc.js";

/**
 * Measurement units are seeded reference data (cup, gram, tablespoon...), not
 * user-managed, so this is read-only.
 *
 * No service file yet. The conversion logic these rows exist for —
 * `conversionFactor` / `baseUnitId`, used to merge "2 cups flour" with "500g
 * flour" — belongs in `lib/units.ts` as pure functions when grocery-list
 * generation lands, not here.
 */
export const unitsRouter = router({
  /** All units, for recipe-ingredient amount pickers. */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.measurementUnit.findMany({ orderBy: { name: "asc" } })
  ),
});
