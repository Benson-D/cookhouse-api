import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

/**
 * Every store, with how many purchases and receipts reference it — the view
 * for spotting duplicates (e.g. "Whole Foods" and a separately-scanned
 * "WHOLE FOODS MARKET #10245") before merging them.
 */
export function list(prisma: PrismaClient) {
  return prisma.store.findMany({
    include: { _count: { select: { purchases: true, receipts: true } } },
    orderBy: { name: "asc" },
  });
}

/**
 * Merges `mergeId` into `keepId`: repoints every Purchase and Receipt from
 * the duplicate onto the canonical store, then deletes the duplicate.
 *
 * Throws NOT_FOUND if either id is missing, BAD_REQUEST if they're the same.
 */
export async function merge(prisma: PrismaClient, keepId: string, mergeId: string) {
  if (keepId === mergeId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Can't merge a store into itself." });
  }

  const [keep, duplicate] = await Promise.all([
    prisma.store.findUnique({ where: { id: keepId } }),
    prisma.store.findUnique({ where: { id: mergeId } }),
  ]);
  if (!keep || !duplicate) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Unknown store." });
  }

  await prisma.$transaction([
    prisma.purchase.updateMany({ where: { storeId: mergeId }, data: { storeId: keepId } }),
    prisma.receipt.updateMany({ where: { storeId: mergeId }, data: { storeId: keepId } }),
    prisma.store.delete({ where: { id: mergeId } }),
  ]);

  return keep;
}
