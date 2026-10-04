import { z } from "zod";

/** `<Date>` pins the input type — in zod 4 a bare `coerce.date()` input is `unknown`, which the published contract would hand the frontend. */
const dateRangeInput = z.object({
  from: z.coerce.date<Date>().optional(),
  to: z.coerce.date<Date>().optional(),
});

/**
 * `userId` filters to one household member's purchases — not restricted to
 * the caller's own id. Grocery lists already have no per-member privacy
 * boundary (any member sees who added/checked what); spending follows the
 * same shared-household model, not a "only see yourself" one.
 */
const filtersInput = z.object({
  storeId: z.string().optional(),
  category: z.string().optional(),
  userId: z.string().optional(),
});

export const summaryInput = dateRangeInput.extend(filtersInput.shape);
export const trendInput = dateRangeInput.extend(filtersInput.shape);

/** No `category` filter — redundant when the report already groups by it. */
export const byCategoryInput = dateRangeInput.extend(filtersInput.omit({ category: true }).shape);

/** No `storeId` filter — redundant when the report already groups by it. */
export const byStoreInput = dateRangeInput.extend(filtersInput.omit({ storeId: true }).shape);

export const topItemsInput = dateRangeInput.extend(filtersInput.shape).extend({
  limit: z.number().int().positive().max(50).default(10),
});

export type DateRangeInput = z.infer<typeof dateRangeInput>;
export type FiltersInput = z.infer<typeof filtersInput>;
export type TopItemsInput = z.infer<typeof topItemsInput>;
