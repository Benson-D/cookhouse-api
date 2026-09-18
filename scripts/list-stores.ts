import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { list } from "../src/modules/stores/stores.service.js";

/**
 * Lists every store, optionally filtered by a case-insensitive substring
 * match on name, with its id and purchase/receipt counts — for spotting a
 * duplicate by eye and finding its id, without typing an exact name.
 *
 *   tsx scripts/list-stores.ts [search]
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  const searchStoreValue = process.argv[2]?.toLowerCase();
  const stores = await list(prisma);
  const matchingStores = searchStoreValue
    ? stores.filter((store) => store.name.toLowerCase().includes(searchStoreValue))
    : stores;

  if (matchingStores.length === 0) {
    console.log("No stores found.");
  } else {
    for (const store of matchingStores) {
      console.log(
        `${store.id}  ${store.name}  (${store._count.purchases} purchases, ${store._count.receipts} receipts)`
      );
    }
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
