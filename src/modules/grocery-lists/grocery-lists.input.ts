import { z } from "zod";

export const addFromRecipesInput = z.object({
  recipeIds: z.array(z.string()).min(1),
});

export const addItemInput = z.object({
  ingredientId: z.string(),
  quantity: z.number().positive().optional(),
  unitId: z.string().optional(),
});

export const setCheckedInput = z.object({
  itemId: z.string(),
  checked: z.boolean(),
});

export const byItemIdInput = z.object({ itemId: z.string() });

/** Archived (completed) lists, newest first. */
export const historyInput = z
  .object({
    skip: z.number().int().nonnegative().default(0),
    take: z.number().int().positive().max(50).default(20),
  })
  .default({ skip: 0, take: 20 });

export type AddItemInput = z.infer<typeof addItemInput>;
export type HistoryInput = z.infer<typeof historyInput>;
