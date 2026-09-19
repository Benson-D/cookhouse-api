import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

/**
 * One-time backfill: common grocery/retail chains and independent markets,
 * so the receipt store picker has something useful to search from day one
 * instead of only whatever's been scanned so far. Upserted uppercase, same
 * normalization findOrCreateStore applies to any store created via receipt
 * scanning — safe to re-run.
 */
const KNOWN_STORES = [
  // National chains
  "Target",
  "Walmart",
  "Costco",
  "Aldi",
  "Whole Foods Market",
  "Trader Joe's",
  "Sam's Club",
  "Meijer",
  "CVS",
  "Walgreens",

  // Chicago-area regional chains
  "Jewel-Osco",
  "Mariano's",
  "Pete's Fresh Market",
  "Cermak Fresh Market",
  "Caputo's Fresh Market",
  "Tony's Fresh Market",
  "Fresh Thyme Market",
  "Fairplay Foods",
  "County Fair Foods",

  // Independent/local grocers
  "Forty Acres Fresh Market",
  "Agora Market",
  "HarvesTime Foods",
  "Chicago French Market",
  "Olivia's Market",
  "Amish & Healthy Foods",
  "Paulina Market",
  "Eataly Chicago",
  "Farmers Pride Produce",
  "Layla & Ringo's",
  "South Loop Market",
  "The Goddess and Grocer",
  "Augusta Food",
  "Riverside Foods",
  "Carnival Foods",

  // Ethnic/international markets
  "Patel Brothers",
  "Kamdar Plaza",
  "Nayab Mart",
  "World Fresh Market",
  "La Unica",
  "Viet Hoa Plaza",
  "Park to Shop",
  "Richwell Market",
  "La Casa del Pueblo",
];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  let created = 0;
  let updated = 0;

  for (const name of KNOWN_STORES) {
    const normalized = name.trim().toUpperCase();
    const existing = await prisma.store.findUnique({ where: { name: normalized } });

    await prisma.store.upsert({
      where: { name: normalized },
      create: { name: normalized },
      update: {},
    });

    if (existing) {
      updated++;
    } else {
      created++;
    }
  }

  console.log(
    `Seeded ${KNOWN_STORES.length} stores: ${created} created, ${updated} already existed.`
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
