import { z } from "zod";
import { householdProcedure, router } from "../../trpc.js";
import {
  attachImageInput,
  createImageUploadInput,
  createRecipeInput,
  listRecipesInput,
  reorderImagesInput,
  setFavoriteInput,
  updateRecipeInput,
} from "./recipes.input.js";
import * as recipes from "./recipes.service.js";
import * as images from "./recipe-images.service.js";

const byId = z.object({ id: z.string() });

export const recipesRouter = router({
  /** Paginated, filterable list of the household's recipes. */
  list: householdProcedure
    .input(listRecipesInput)
    .query(({ ctx, input }) => recipes.listForHousehold(ctx.prisma, input, ctx)),

  /** One recipe in full, with ingredients, units, tags and favorite state. */
  getById: householdProcedure
    .input(byId)
    .query(({ ctx, input }) => recipes.getForHousehold(ctx.prisma, input.id, ctx)),

  create: householdProcedure
    .input(createRecipeInput)
    .mutation(({ ctx, input }) => recipes.create(ctx.prisma, input, ctx)),

  /** Author or admin only. */
  update: householdProcedure
    .input(updateRecipeInput)
    .mutation(({ ctx, input }) => recipes.update(ctx.prisma, input, ctx)),

  /** Author or admin only. */
  delete: householdProcedure
    .input(byId)
    .mutation(({ ctx, input }) => recipes.remove(ctx.prisma, input.id, ctx)),

  /** Personal favorite — any member, any household recipe. */
  setFavorite: householdProcedure
    .input(setFavoriteInput)
    .mutation(({ ctx, input }) =>
      recipes.setFavorite(ctx.prisma, input.id, input.favorited, ctx)
    ),

  /** Images with render URLs, thumbnail first. */
  images: householdProcedure
    .input(byId)
    .query(({ ctx, input }) => images.listWithUrls(ctx.prisma, input.id)),

  /**
   * Step 1 of upload: returns a presigned PUT the client sends bytes to.
   * Call once per file — several calls give several uploads.
   */
  createImageUpload: householdProcedure
    .input(createImageUploadInput)
    .mutation(({ ctx, input }) =>
      images.createUpload(ctx.prisma, input.recipeId, input.contentType, ctx)
    ),

  /** Step 2 of upload: record the uploaded object against the recipe. */
  attachImage: householdProcedure
    .input(attachImageInput)
    .mutation(({ ctx, input }) =>
      images.attach(ctx.prisma, input.recipeId, input.storageKey, input.caption, ctx)
    ),

  removeImage: householdProcedure
    .input(z.object({ imageId: z.string() }))
    .mutation(({ ctx, input }) => images.remove(ctx.prisma, input.imageId, ctx)),

  /** Reorder; index 0 becomes the thumbnail. Must list every image. */
  reorderImages: householdProcedure
    .input(reorderImagesInput)
    .mutation(({ ctx, input }) =>
      images.reorder(ctx.prisma, input.recipeId, input.imageIds, ctx)
    ),
});
