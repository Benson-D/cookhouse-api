import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import {
  buildRecipeImageKey,
  createReadUrl,
  createUploadUrl,
  deleteObject,
  ensureWebSafeImage,
  isAllowedImageType,
  keyBelongsToRecipe,
  MAX_UPLOAD_BYTES,
} from "../../lib/storage.js";

type Actor = { clerkOrgId: string; clerkUserId: string };

/**
 * Viewing and editing a recipe's photos both require the same thing: the
 * recipe belongs to the caller's household. Used by every function below,
 * including the read path — `recipes.images` had no household check at all
 * before this, unlike every other recipe procedure.
 */
async function assertRecipeInHousehold(
  prisma: PrismaClient,
  recipeId: string,
  actor: Actor
) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { clerkOrgId: true },
  });
  if (!recipe || recipe.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}

/**
 * Issues a presigned PUT for one recipe photo. Permission is checked here,
 * before the URL exists — it's a bearer credential for writing that object.
 *
 * Throws BAD_REQUEST for an unsupported content type or an oversized file,
 * NOT_FOUND if the recipe is missing or belongs to another household.
 */
export async function createUpload(
  prisma: PrismaClient,
  recipeId: string,
  contentType: string,
  contentLength: number,
  actor: Actor
) {
  await assertRecipeInHousehold(prisma, recipeId, actor);

  if (!isAllowedImageType(contentType)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unsupported image type: ${contentType}`,
    });
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Image is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`,
    });
  }

  const storageKey = buildRecipeImageKey(actor.clerkOrgId, recipeId, contentType);
  return {
    storageKey,
    uploadUrl: await createUploadUrl(storageKey, contentType, contentLength),
  };
}

/**
 * Records an uploaded object against the recipe, converting it via
 * `ensureWebSafeImage` first if it's actually HEIC. Its replaced extension
 * still matches this recipe's key prefix, so the belongs-to-recipe check
 * below still holds for the returned key.
 *
 * New images sort to the end; the first image (sortOrder 0) is the thumbnail.
 *
 * Writes: RecipeImage.
 * Throws NOT_FOUND as `createUpload`, CONFLICT if the key is already
 * attached.
 */
export async function attach(
  prisma: PrismaClient,
  recipeId: string,
  storageKey: string,
  caption: string | undefined,
  actor: Actor
) {
  await assertRecipeInHousehold(prisma, recipeId, actor);

  if (!keyBelongsToRecipe(storageKey, actor.clerkOrgId, recipeId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Key does not belong to recipe" });
  }

  const webSafeKey = await ensureWebSafeImage(storageKey);

  const last = await prisma.recipeImage.findFirst({
    where: { recipeId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  return prisma.recipeImage.create({
    data: {
      recipeId,
      storageKey: webSafeKey,
      caption,
      sortOrder: last ? last.sortOrder + 1 : 0,
    },
  });
}

/**
 * Removes an image from the recipe and deletes the underlying object.
 *
 * The row is deleted first: a failed bucket delete leaves an orphan object,
 * which a lifecycle rule can sweep, whereas the reverse order would leave a
 * row pointing at nothing and break every render of the recipe.
 *
 * Writes: RecipeImage (delete), and the bucket object.
 */
export async function remove(prisma: PrismaClient, imageId: string, actor: Actor) {
  const image = await prisma.recipeImage.findUnique({
    where: { id: imageId },
    select: { storageKey: true, recipeId: true },
  });
  if (!image) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  await assertRecipeInHousehold(prisma, image.recipeId, actor);

  await prisma.recipeImage.delete({ where: { id: imageId } });
  await deleteObject(image.storageKey).catch(() => {
    // Orphaned object; the row is already gone, which is the state that matters.
  });

  return { ok: true };
}

/**
 * Sets image order for a recipe. `imageIds` must list every image exactly
 * once — a partial list would leave duplicate sortOrder values and an
 * ambiguous thumbnail.
 *
 * Writes: RecipeImage.sortOrder, in one transaction.
 * Throws BAD_REQUEST if the ids don't match the recipe's images exactly.
 */
export async function reorder(
  prisma: PrismaClient,
  recipeId: string,
  imageIds: string[],
  actor: Actor
) {
  await assertRecipeInHousehold(prisma, recipeId, actor);

  const current = await prisma.recipeImage.findMany({
    where: { recipeId },
    select: { id: true },
  });
  const expected = new Set(current.map((image) => image.id));
  const received = new Set(imageIds);
  const matches =
    expected.size === received.size && [...expected].every((id) => received.has(id));
  if (!matches) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "imageIds must list every image of this recipe exactly once",
    });
  }

  await prisma.$transaction(
    imageIds.map((id, index) =>
      prisma.recipeImage.update({ where: { id }, data: { sortOrder: index } })
    )
  );

  return prisma.recipeImage.findMany({
    where: { recipeId },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Image rows for a recipe, each with a URL the client can render.
 *
 * URLs are generated per call rather than stored: presigned reads expire, and
 * a stored URL would rot if the bucket or CDN host ever changes.
 *
 * Throws NOT_FOUND if the recipe is missing or belongs to another household —
 * without this, any signed-in user could read another household's recipe
 * photos by passing its recipe id directly.
 */
export async function listWithUrls(prisma: PrismaClient, recipeId: string, actor: Actor) {
  await assertRecipeInHousehold(prisma, recipeId, actor);

  const images = await prisma.recipeImage.findMany({
    where: { recipeId },
    orderBy: { sortOrder: "asc" },
  });

  return Promise.all(
    images.map(async (image) => ({ ...image, url: await createReadUrl(image.storageKey) }))
  );
}
