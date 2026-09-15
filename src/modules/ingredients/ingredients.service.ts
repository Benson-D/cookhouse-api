import type { PrismaClient } from "@prisma/client";
import { categorize } from "../../lib/categorize.js";
import { escapeLikeWildcards } from "../../lib/search.js";

/**
 * Ingredients are a single global list shared by every household — see
 * ARCHITECTURE.md. Fragmenting "onion" into per-household rows would silently
 * break grocery-list merging and spend-by-item reports, so these procedures
 * are deliberately not scoped by `clerkOrgId`.
 */

/**
 * Ingredients matching `search` (case-insensitive), or all of them.
 * `take` is capped so a client can't request an unbounded page — mirrors
 * `recipes.list`.
 */
export function list(prisma: PrismaClient, search: string | undefined, take: number) {
  const term = search?.trim();
  return prisma.ingredient.findMany({
    where: term ? { name: { contains: escapeLikeWildcards(term), mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
    take,
  });
}

/**
 * The read half of `findOrCreate` — same alias-then-exact-name lookup,
 * without the create. For previewing whether a name already resolves to an
 * ingredient (a scanned receipt line, say) before anything is committed;
 * creating one at preview time would be premature since nothing's been
 * confirmed yet. A small, deliberate duplication of `findOrCreate`'s lookup
 * rather than a shared refactor, so a preview-only check can never risk
 * changing that function's already-relied-upon behavior.
 */
export async function findExisting(prisma: PrismaClient, name: string) {
  const normalized = name.trim().toLowerCase();
  const alias = await prisma.ingredientAlias.findFirst({
    where: { aliasText: { equals: normalized, mode: "insensitive" } },
    include: { ingredient: true },
  });
  if (alias) {
    return alias.ingredient;
  }
  return prisma.ingredient.findFirst({ where: { name: { equals: normalized, mode: "insensitive" } } });
}

/**
 * Resolves a name to its canonical `Ingredient`, creating one if new.
 *
 * Checks `IngredientAlias` first, so messy text already mapped to a canonical
 * row ("ORG MLK 2%" → "milk") reuses it instead of creating a near-duplicate.
 * Falls back to an exact name match, then to creating a fresh ingredient.
 *
 * Stores `name` lowercased (matching every seeded ingredient already in the
 * table) — the upsert below targets `Ingredient.name`'s unique constraint
 * directly, which can't be matched case-insensitively the way a plain
 * lookup can, so "Tomatoes" would otherwise create a second row alongside
 * an existing "tomatoes" instead of resolving to it.
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
  const normalized = name.trim().toLowerCase();

  const alias = await prisma.ingredientAlias.findFirst({
    where: { aliasText: { equals: normalized, mode: "insensitive" } },
    include: { ingredient: true },
  });
  if (alias) {
    return alias.ingredient;
  }

  // Only guessed on creation — an existing ingredient's category is never
  // silently overwritten by a later, possibly-worse guess.
  const resolvedCategory = category ?? categorize(normalized) ?? undefined;

  return prisma.ingredient.upsert({
    where: { name: normalized },
    create: { name: normalized, category: resolvedCategory },
    update: {},
  });
}
