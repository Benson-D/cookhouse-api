import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

/**
 * Seeds reference data: measurement units and the curated tag vocabulary.
 *
 * Idempotent — every write is an upsert keyed on the row's unique `name`, so
 * re-running only fills gaps and never duplicates. Safe against a live DB.
 *
 * Units are seeded as one base unit per type with the rest expressed as a
 * `conversionFactor` into it, which is what lib/units.ts needs to merge
 * grocery-list lines. Volume and weight stay separate families on purpose:
 * converting between them needs per-ingredient density we deliberately don't model.
 */

const VOLUME_BASE = "milliliter";
const WEIGHT_BASE = "gram";
const COUNT_BASE = "piece";

const units: Array<{
  name: string;
  abbreviation: string | null;
  type: string;
  /** Multiplier into the type's base unit; the base itself is 1. */
  factor: number;
}> = [
  { name: VOLUME_BASE, abbreviation: "ml", type: "volume", factor: 1 },
  { name: "liter", abbreviation: "L", type: "volume", factor: 1000 },
  { name: "teaspoon", abbreviation: "tsp", type: "volume", factor: 4.92892 },
  { name: "tablespoon", abbreviation: "tbsp", type: "volume", factor: 14.7868 },
  { name: "fluid ounce", abbreviation: "fl oz", type: "volume", factor: 29.5735 },
  { name: "cup", abbreviation: "cup", type: "volume", factor: 236.588 },
  { name: "pint", abbreviation: "pt", type: "volume", factor: 473.176 },
  { name: "quart", abbreviation: "qt", type: "volume", factor: 946.353 },
  { name: "gallon", abbreviation: "gal", type: "volume", factor: 3785.41 },

  { name: WEIGHT_BASE, abbreviation: "g", type: "weight", factor: 1 },
  { name: "milligram", abbreviation: "mg", type: "weight", factor: 0.001 },
  { name: "kilogram", abbreviation: "kg", type: "weight", factor: 1000 },
  { name: "ounce", abbreviation: "oz", type: "weight", factor: 28.3495 },
  { name: "pound", abbreviation: "lb", type: "weight", factor: 453.592 },

  { name: COUNT_BASE, abbreviation: null, type: "count", factor: 1 },
  { name: "dozen", abbreviation: "doz", type: "count", factor: 12 },
];

const tags: Array<{ name: string; type: string }> = [
  ...["italian", "mexican", "thai", "indian", "chinese", "japanese", "mediterranean", "american"].map(
    (name) => ({ name, type: "cuisine" })
  ),
  ...["vegetarian", "vegan", "gluten-free", "dairy-free", "nut-free"].map((name) => ({
    name,
    type: "diet",
  })),
  ...["breakfast", "lunch", "dinner", "dessert", "snack", "side"].map((name) => ({
    name,
    type: "meal_type",
  })),
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  // Base units first — the rest reference them via baseUnitId.
  const bases = new Map<string, string>();
  for (const name of [VOLUME_BASE, WEIGHT_BASE, COUNT_BASE]) {
    const unit = units.find((u) => u.name === name)!;
    const row = await prisma.measurementUnit.upsert({
      where: { name: unit.name },
      create: {
        name: unit.name,
        abbreviation: unit.abbreviation,
        type: unit.type,
        conversionFactor: 1,
      },
      update: { abbreviation: unit.abbreviation, type: unit.type, conversionFactor: 1 },
    });
    bases.set(unit.type, row.id);
  }

  for (const unit of units.filter((u) => u.factor !== 1 || !bases.has(u.type))) {
    if (unit.name === VOLUME_BASE || unit.name === WEIGHT_BASE || unit.name === COUNT_BASE) {
      continue;
    }
    await prisma.measurementUnit.upsert({
      where: { name: unit.name },
      create: {
        name: unit.name,
        abbreviation: unit.abbreviation,
        type: unit.type,
        conversionFactor: unit.factor,
        baseUnitId: bases.get(unit.type),
      },
      update: {
        abbreviation: unit.abbreviation,
        type: unit.type,
        conversionFactor: unit.factor,
        baseUnitId: bases.get(unit.type),
      },
    });
  }

  for (const tag of tags) {
    await prisma.tag.upsert({
      where: { name: tag.name },
      create: tag,
      update: { type: tag.type },
    });
  }

  const [unitCount, tagCount] = await Promise.all([
    prisma.measurementUnit.count(),
    prisma.tag.count(),
  ]);
  console.log(`Seeded: ${unitCount} measurement units, ${tagCount} tags.`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
