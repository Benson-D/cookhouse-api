import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { categorize } from "../src/lib/categorize.js";

/**
 * One-time backfill: guesses a category for every existing `Ingredient` row
 * that doesn't have one yet, using the same `categorize()` logic
 * `findOrCreate` already applies to brand-new ingredients. Never touches a
 * row that already has a category. Safe to re-run — anything still
 * uncategorized afterward just means `categorize()` genuinely can't
 * confidently match it, not a failure of the script.
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  const uncategorized = await prisma.ingredient.findMany({ where: { category: null } });

  let updated = 0;
  for (const ingredient of uncategorized) {
    const category = categorize(ingredient.name);
    if (category) {
      await prisma.ingredient.update({ where: { id: ingredient.id }, data: { category } });
      updated++;
    }
  }

  console.log(
    `Backfilled ${updated} of ${uncategorized.length} previously-uncategorized ingredients ` +
      `(${uncategorized.length - updated} still uncategorized).`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
