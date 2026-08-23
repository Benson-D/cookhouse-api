import type { PrismaClient } from "@prisma/client";

/**
 * Ingredients are a single global list shared by every household — see
 * ARCHITECTURE.md. Fragmenting "onion" into per-household rows would silently
 * break grocery-list merging and spend-by-item reports, so these procedures
 * are deliberately not scoped by `clerkOrgId`.
 */

/** Ingredients matching `search` (case-insensitive), or all of them. */
export function list(prisma: PrismaClient, search?: string) {
  return prisma.ingredient.findMany({
    where: search ? { name: { contains: search, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
  });
}

/**
 * Resolves a name to its canonical `Ingredient`, creating one if new.
 *
 * Checks `IngredientAlias` first, so messy text already mapped to a canonical
 * row ("ORG MLK 2%" → "milk") reuses it instead of creating a near-duplicate.
 * Falls back to an exact name match, then to creating a fresh ingredient.
 *
 * Writes: Ingredient (only when the name is genuinely new).
 * Never throws on an existing name — concurrent callers converge on one row
 * via upsert rather than colliding on the unique constraint.
 */
export async function findOrCreate(
  prisma: PrismaClient,
  name: string,
  category?: string
) {
  const alias = await prisma.ingredientAlias.findFirst({
    where: { aliasText: { equals: name, mode: "insensitive" } },
    include: { ingredient: true },
  });
  if (alias) {
    return alias.ingredient;
  }

  return prisma.ingredient.upsert({
    where: { name },
    create: { name, category },
    update: {},
  });
}
