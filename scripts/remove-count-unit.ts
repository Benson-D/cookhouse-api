import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

/**
 * One-time cleanup: removes the "piece"/"dozen" MeasurementUnit rows left
 * over from before that unit family was dropped (see seed.ts). Any row still
 * referencing one gets its unitId cleared first — matching the "no unit"
 * convention plain counting uses now — since deleting the unit while
 * something still points at it would leave a dangling reference.
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  const units = await prisma.measurementUnit.findMany({
    where: { name: { in: ["piece", "dozen"] } },
  });

  if (units.length === 0) {
    console.log("Nothing to do — no piece/dozen unit rows found.");
    await prisma.$disconnect();
    return;
  }

  const unitIds = units.map((u) => u.id);
  console.log(`Found: ${units.map((u) => u.name).join(", ")}`);

  const [recipeIngredients, groceryListItems, purchases] = await Promise.all([
    prisma.recipeIngredient.updateMany({
      where: { unitId: { in: unitIds } },
      data: { unitId: null },
    }),
    prisma.groceryListItem.updateMany({
      where: { unitId: { in: unitIds } },
      data: { unitId: null },
    }),
    prisma.purchase.updateMany({
      where: { unitId: { in: unitIds } },
      data: { unitId: null },
    }),
  ]);

  // dozen's baseUnitId points at piece, and that self-relation is Restrict —
  // clear it before either can be deleted.
  await prisma.measurementUnit.updateMany({
    where: { baseUnitId: { in: unitIds } },
    data: { baseUnitId: null },
  });
  await prisma.measurementUnit.deleteMany({ where: { id: { in: unitIds } } });

  console.log(
    `Cleared unitId on ${recipeIngredients.count} recipe ingredients, ` +
      `${groceryListItems.count} grocery list items, ${purchases.count} purchases. ` +
      `Deleted ${units.length} unit row(s).`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
