import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { merge } from "../src/modules/stores/stores.service.js";

/**
 * Merges mergeId into keepId via stores.service's merge — the same function
 * the admin tRPC procedure calls, just run directly by hand. Use
 * list-stores.ts first to find both ids.
 *
 *   tsx scripts/merge-store.ts <keepId> <mergeId>
 */
async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  const [keepId, mergeId] = process.argv.slice(2);
  if (!keepId || !mergeId) {
    console.error("Usage: tsx scripts/merge-store.ts <keepId> <mergeId>");
    process.exit(1);
  }

  const keptStore = await merge(prisma, keepId, mergeId);
  console.log(`Merged ${mergeId} into ${keepId} ("${keptStore.name}").`);

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
