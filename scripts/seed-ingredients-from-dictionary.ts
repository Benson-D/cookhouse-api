import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { CATEGORIES, OVERRIDES } from "../src/lib/categorize.js";

/**
 * One-time backfill: turns every name categorize() already knows about into
 * a real, searchable Ingredient row with its category pre-set. Upserts, so
 * it's safe to re-run — an ingredient that already exists just gets its
 * category refreshed to match, never deleted or otherwise touched.
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  const known: Array<{ name: string; category: string }> = OVERRIDES.map(
    ({ phrase, category }) => ({ name: phrase, category })
  );
  for (const [category, keywords] of Object.entries(CATEGORIES)) {
    for (const name of keywords) {
      known.push({ name, category });
    }
  }

  let created = 0;
  let updated = 0;

  for (const { name, category } of known) {
    const normalized = name.trim().toLowerCase();
    const existing = await prisma.ingredient.findUnique({ where: { name: normalized } });

    await prisma.ingredient.upsert({
      where: { name: normalized },
      create: { name: normalized, category },
      update: { category },
    });

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  console.log(`Seeded ${known.length} known ingredients: ${created} created, ${updated} updated.`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
