import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { categorize } from "../src/lib/categorize.js";

/**
 * Two passes, both scoped narrowly rather than re-running categorize() over
 * every row (which would also clobber a category set deliberately, if that
 * path ever exists — it doesn't today, but this stays safe either way):
 *
 * 1. Fills in every `category: null` row — unchanged from before, and still
 *    safe to re-run; anything still uncategorized afterward just means
 *    categorize() genuinely can't confidently match it.
 *
 * 2. Corrects rows stuck on a stale "meat" category from before "seafood"
 *    was split out of it — only rows currently "meat" whose name now
 *    resolves to "seafood" are touched, nothing else.
 *
 * --dry-run reports every change either pass would make, with the before
 * and after category, without writing anything.
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });
  const dryRun = process.argv.includes("--dry-run");

  const uncategorized = await prisma.ingredient.findMany({ where: { category: null } });
  let filled = 0;
  for (const ingredient of uncategorized) {
    const category = categorize(ingredient.name);
    if (!category) continue;

    console.log(`[fill] ${ingredient.name}: (none) -> ${category}`);
    if (!dryRun) {
      await prisma.ingredient.update({ where: { id: ingredient.id }, data: { category } });
    }
    filled++;
  }

  const staleMeat = await prisma.ingredient.findMany({ where: { category: "meat" } });
  let corrected = 0;
  for (const ingredient of staleMeat) {
    const category = categorize(ingredient.name);
    if (category !== "seafood") continue;

    console.log(`[correct] ${ingredient.name}: meat -> seafood`);
    if (!dryRun) {
      await prisma.ingredient.update({ where: { id: ingredient.id }, data: { category } });
    }
    corrected++;
  }

  const verb = dryRun ? "Would fill" : "Filled";
  const verb2 = dryRun ? "would correct" : "corrected";
  console.log(
    `${verb} ${filled} of ${uncategorized.length} previously-uncategorized ingredients ` +
      `(${uncategorized.length - filled} still uncategorized), and ${verb2} ${corrected} of ` +
      `${staleMeat.length} "meat" rows that are actually seafood.`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
