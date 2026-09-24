import type { PrismaClient } from "@prisma/client";
import { categorize, categorizeExact } from "../../lib/categorize.js";
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

/**
 * Like `findOrCreate`, but never invents an ingredient for something
 * unrecognized — a miss only creates when `categorize()` confidently
 * recognizes the name (food, household, alcohol, whatever — as long as
 * it's a real thing), unlike `findOrCreate`, which always creates even when
 * `categorize()` comes back empty. Returns `null` on a miss, leaving the
 * caller to decide the fallback (a free-text label, typically).
 *
 * Writes: Ingredient (only when genuinely new and confidently categorized).
 */
export async function findOrCreateIfRecognized(prisma: PrismaClient, name: string) {
  const existing = await findExisting(prisma, name);
  if (existing) return existing;

  const category = categorize(name);
  if (!category) return null;

  const normalized = name.trim().toLowerCase();
  // upsert, not create — two concurrent callers resolving the same new name
  // converge on one row instead of colliding on the unique constraint.
  return prisma.ingredient.upsert({
    where: { name: normalized },
    create: { name: normalized, category },
    update: {},
  });
}

/**
 * Like `findOrCreateIfRecognized`, but uses `categorizeExact` — used by
 * `groceryLists.addItem`, since typed text can be a free-text note rather
 * than an item name. Receipts keep using `findOrCreateIfRecognized`.
 *
 * Writes: Ingredient (only when genuinely new and an exact keyword match).
 */
export async function findOrCreateIfExactMatch(prisma: PrismaClient, name: string) {
  const existing = await findExisting(prisma, name);
  if (existing) return existing;

  const category = categorizeExact(name);
  if (!category) return null;

  const normalized = name.trim().toLowerCase();
  return prisma.ingredient.upsert({
    where: { name: normalized },
    create: { name: normalized, category },
    update: {},
  });
}
