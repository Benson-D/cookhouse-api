import { z } from "zod";

const dateRangeInput = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
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

export const summaryInput = dateRangeInput.merge(filtersInput);
export const trendInput = dateRangeInput.merge(filtersInput);

/** No `category` filter — redundant when the report already groups by it. */
export const byCategoryInput = dateRangeInput.merge(filtersInput.omit({ category: true }));

/** No `storeId` filter — redundant when the report already groups by it. */
export const byStoreInput = dateRangeInput.merge(filtersInput.omit({ storeId: true }));

export const topItemsInput = dateRangeInput.merge(filtersInput).extend({
  limit: z.number().int().positive().max(50).default(10),
});

export type DateRangeInput = z.infer<typeof dateRangeInput>;
export type FiltersInput = z.infer<typeof filtersInput>;
export type TopItemsInput = z.infer<typeof topItemsInput>;
