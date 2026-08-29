import { z } from "zod";

const recipeStepInput = z.object({
  step: z.number(),
  text: z.string(),
  timerSeconds: z.number().optional(),
});

const recipeIngredientInput = z.object({
  ingredientId: z.string(),
  unitId: z.string().optional(),
  amount: z.number().positive().optional(),
  notes: z.string().optional(),
});

export const createRecipeInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  servings: z.number().int().positive().optional(),
  prepTime: z.number().int().nonnegative().optional(),
  cookingTime: z.number().int().nonnegative().optional(),
  instructions: z.array(recipeStepInput),
  sourceUrl: z.string().url().optional(),
  ingredients: z.array(recipeIngredientInput).default([]),
  tagIds: z.array(z.string()).default([]),
});

export const updateRecipeInput = createRecipeInput.partial().extend({
  id: z.string(),
});

/**
 * Filters for the household recipe list. All are optional and combine with
 * AND, except `tagIds`, which matches a recipe carrying *any* of the given
 * tags — filter chips read as "cuisine: italian OR thai", not "both at once".
 *
 * `take` is capped so a client can't request an unbounded page.
 */
export const listRecipesInput = z
  .object({
    search: z.string().max(100).optional(),
    tagIds: z.array(z.string()).optional(),
    maxCookingTime: z.number().int().positive().optional(),
    favoritesOnly: z.boolean().optional(),
    skip: z.number().int().nonnegative().default(0),
    take: z.number().int().positive().max(100).default(20),
  })
  .default({ skip: 0, take: 20 });

export const setFavoriteInput = z.object({
  id: z.string(),
  favorited: z.boolean(),
});

/**
 * Content type and size are declared up front so the presigned URL can pin
 * both. `contentLength`'s own upper bound is a courtesy — the real cap is
 * `MAX_UPLOAD_BYTES`, enforced in the service against a shared constant.
 */
export const createImageUploadInput = z.object({
  recipeId: z.string(),
  contentType: z.string(),
  contentLength: z.number().int().positive(),
});

export const attachImageInput = z.object({
  recipeId: z.string(),
  storageKey: z.string(),
  caption: z.string().optional(),
});

export const reorderImagesInput = z.object({
  recipeId: z.string(),
  imageIds: z.array(z.string()).min(1),
});

export type CreateRecipeInput = z.infer<typeof createRecipeInput>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeInput>;
export type ListRecipesInput = z.infer<typeof listRecipesInput>;
