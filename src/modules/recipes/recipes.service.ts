import { TRPCError } from "@trpc/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import { assertCanModify } from "../../lib/access.js";
import { getOrSync } from "../users/users.service.js";
import type {
  CreateRecipeInput,
  ListRecipesInput,
  UpdateRecipeInput,
} from "./recipes.input.js";

type Actor = { clerkOrgId: string; clerkUserId: string };

const summaryInclude = {
  tags: { include: { tag: true } },
} satisfies Prisma.RecipeInclude;

const detailInclude = {
  ingredients: { include: { ingredient: true, unit: true } },
  tags: { include: { tag: true } },
  images: { orderBy: { sortOrder: "asc" } },
} satisfies Prisma.RecipeInclude;

/**
 * Return shapes are named rather than left to inference, for one concrete
 * reason: the `AppRouter` type crosses the workspace boundary, and the web app
 * resolves it with `inferRouterOutputs`.
 *
 * Two things break that walk if left alone. `Recipe.instructions` is Prisma
 * `Json`, and `JsonValue` is *recursive* — tRPC traverses output types to work
 * out what serializes, and that recursion tips the frontend into TS2589
 * ("excessively deep"). Spreading a deeply-included payload to bolt on
 * `isFavorited` compounds it. So the column is re-typed as `unknown` at the API
 * boundary — honest, since it's unstructured by design and every client parses
 * it defensively — and the flag is added as an intersection rather than a
 * spread.
 */
type OpaqueInstructions<T> = Omit<T, "instructions"> & { instructions: unknown };

type RecipeSummaryRow = OpaqueInstructions<
  Prisma.RecipeGetPayload<{ include: typeof summaryInclude }>
>;
type RecipeDetailRow = OpaqueInstructions<
  Prisma.RecipeGetPayload<{ include: typeof detailInclude }>
>;
type Favoritable<T> = T & { isFavorited: boolean };

/**
 * Marks each recipe with the caller's *own* favorite state.
 *
 * Favorites are personal, so this is one flat lookup of the caller's rows for
 * the page, checked in memory — deliberately not a filtered `favoritedBy`
 * include on the recipe query, which would attach a per-recipe array typed as
 * the full relation while holding only the caller's rows, and would then have
 * to be stripped back off before returning.
 */
async function withIsFavorited<T extends { id: string }>(
  prisma: PrismaClient,
  recipes: T[],
  userId: string
): Promise<Favoritable<T>[]> {
  if (recipes.length === 0) {
    return [];
  }

  const favorites = await prisma.userFavoriteRecipe.findMany({
    where: { userId, recipeId: { in: recipes.map((recipe) => recipe.id) } },
    select: { recipeId: true },
  });
  const favorited = new Set(favorites.map((favorite) => favorite.recipeId));

  return recipes.map((recipe) => ({
    ...recipe,
    isFavorited: favorited.has(recipe.id),
  }));
}

/**
 * A page of the household's recipes, newest first, with the total matching
 * count so the client can paginate.
 *
 * Summary shape only — tags but no ingredient rows, since a list view doesn't
 * render them and joining them across a page is wasted work.
 *
 * Every row carries `isFavorited` for the caller, so the local `User` row is
 * resolved on every call rather than only for `favoritesOnly` (favorites are
 * keyed by `User.id`, not the Clerk id). This is also the lazy-sync point that
 * creates the row on a user's first authenticated request.
 */
export async function listForHousehold(
  prisma: PrismaClient,
  filters: ListRecipesInput,
  actor: Actor
): Promise<{
  recipes: Favoritable<RecipeSummaryRow>[];
  total: number;
  skip: number;
  take: number;
}> {
  const { search, tagIds, maxCookingTime, favoritesOnly, skip, take } = filters;

  const user = await getOrSync(prisma, actor.clerkUserId);

  const where: Prisma.RecipeWhereInput = {
    clerkOrgId: actor.clerkOrgId,
    ...(search && { name: { contains: search, mode: "insensitive" } }),
    ...(maxCookingTime && { cookingTime: { lte: maxCookingTime } }),
    ...(tagIds?.length && { tags: { some: { tagId: { in: tagIds } } } }),
    ...(favoritesOnly && { favoritedBy: { some: { userId: user.id } } }),
  };

  const [recipes, total] = await prisma.$transaction([
    prisma.recipe.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: summaryInclude,
      skip,
      take,
    }),
    prisma.recipe.count({ where }),
  ]);

  return {
    recipes: await withIsFavorited(prisma, recipes, user.id),
    total,
    skip,
    take,
  };
}

/**
 * One recipe with ingredients, units and tags, plus the caller's own
 * `isFavorited` state.
 *
 * Throws NOT_FOUND both when the recipe is missing and when it belongs to
 * another household, so nothing leaks about other households' contents. The
 * favorite lookup runs only after that check passes.
 */
export async function getForHousehold(
  prisma: PrismaClient,
  id: string,
  actor: Actor
): Promise<Favoritable<RecipeDetailRow>> {
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: detailInclude,
  });
  if (!recipe || recipe.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const user = await getOrSync(prisma, actor.clerkUserId);
  const favorite = await prisma.userFavoriteRecipe.findUnique({
    where: { userId_recipeId: { userId: user.id, recipeId: id } },
    select: { recipeId: true },
  });

  return { ...recipe, isFavorited: favorite !== null };
}

/**
 * Creates a recipe owned by the actor's household, authored by the actor.
 *
 * Writes: Recipe, RecipeIngredient, RecipeTag.
 * Ingredient and tag rows must already exist — resolve names to ids via
 * `ingredients.findOrCreate` and `tags.list` before calling.
 * Throws NOT_FOUND if any referenced ingredient, unit or tag id is unknown.
 */
export function create(
  prisma: PrismaClient,
  input: CreateRecipeInput,
  actor: Actor
): Promise<RecipeDetailRow> {
  const { ingredients, tagIds, instructions, ...fields } = input;
  return prisma.recipe.create({
    data: {
      ...fields,
      instructions: instructions as Prisma.InputJsonValue,
      clerkOrgId: actor.clerkOrgId,
      createdBy: actor.clerkUserId,
      ingredients: { create: ingredients },
      tags: { create: tagIds.map((tagId) => ({ tagId })) },
    },
    include: detailInclude,
  });
}

/**
 * Updates a recipe's fields, and replaces its ingredients/tags when supplied.
 *
 * Ingredients and tags are replaced wholesale rather than diffed — the client
 * always submits the full list. Omitting either key leaves it untouched;
 * passing an empty array clears it.
 *
 * Writes: Recipe, and RecipeIngredient / RecipeTag when those keys are given.
 * The clear and re-create run in one transaction, so a failure rolls back
 * rather than leaving a recipe stripped of its ingredients.
 * Throws NOT_FOUND if the recipe is missing or owned by another household,
 * FORBIDDEN if the actor is neither its author nor an admin.
 */
export async function update(
  prisma: PrismaClient,
  input: UpdateRecipeInput,
  actor: Actor
): Promise<RecipeDetailRow> {
  const { id, ingredients, tagIds, instructions, ...fields } = input;

  const existing = await prisma.recipe.findUnique({
    where: { id },
    select: { clerkOrgId: true, createdBy: true },
  });
  await assertCanModify(prisma, existing, actor);

  return prisma.$transaction(async (tx) => {
    if (ingredients) {
      await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
    }
    if (tagIds) {
      await tx.recipeTag.deleteMany({ where: { recipeId: id } });
    }
    return tx.recipe.update({
      where: { id },
      data: {
        ...fields,
        ...(instructions && {
          instructions: instructions as Prisma.InputJsonValue,
        }),
        ...(ingredients && { ingredients: { create: ingredients } }),
        ...(tagIds && { tags: { create: tagIds.map((tagId) => ({ tagId })) } }),
      },
      include: detailInclude,
    });
  });
}

/**
 * Deletes a recipe.
 *
 * Writes: Recipe, cascading to RecipeIngredient, RecipeTag and
 * UserFavoriteRecipe — those rows are meaningless without their parent.
 * Purchase history is unaffected: it hangs off Ingredient, not Recipe.
 * Throws NOT_FOUND if the recipe is missing or owned by another household,
 * FORBIDDEN if the actor is neither its author nor an admin.
 */
export async function remove(prisma: PrismaClient, id: string, actor: Actor) {
  const existing = await prisma.recipe.findUnique({
    where: { id },
    select: { clerkOrgId: true, createdBy: true },
  });
  await assertCanModify(prisma, existing, actor);

  await prisma.recipe.delete({ where: { id } });
  return { ok: true };
}

/**
 * Adds or removes the recipe from the caller's favorites.
 *
 * Favorites are personal, not household-wide, so any member may favorite any
 * recipe their household can see — authorship is irrelevant here, unlike
 * update/delete.
 *
 * Writes: UserFavoriteRecipe, and User on a first-ever request (via getOrSync,
 * since favorites are keyed by local `User.id` rather than the Clerk id).
 * Idempotent in both directions — favoriting twice or unfavoriting something
 * that was never favorited both succeed.
 * Throws NOT_FOUND if the recipe is missing or owned by another household.
 */
export async function setFavorite(
  prisma: PrismaClient,
  recipeId: string,
  favorited: boolean,
  actor: Actor
) {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    select: { clerkOrgId: true },
  });
  if (!recipe || recipe.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const user = await getOrSync(prisma, actor.clerkUserId);

  if (favorited) {
    await prisma.userFavoriteRecipe.upsert({
      where: { userId_recipeId: { userId: user.id, recipeId } },
      create: { userId: user.id, recipeId },
      update: {},
    });
  } else {
    await prisma.userFavoriteRecipe.deleteMany({
      where: { userId: user.id, recipeId },
    });
  }

  return { favorited };
}
