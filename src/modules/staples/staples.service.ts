import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";

type Actor = { clerkOrgId: string; clerkUserId: string };

/**
 * Every staple for the household — ingredient joined in so a management
 * screen doesn't need a lookup per row. No `userId` filter: staples are
 * household state, same as the grocery list itself (see root CLAUDE.md's
 * domain rules) — whoever created one, it applies to everyone.
 */
export function list(prisma: PrismaClient, actor: Actor) {
  return prisma.stapleReminder.findMany({
    where: { clerkOrgId: actor.clerkOrgId },
    include: { ingredient: true },
    orderBy: { ingredient: { name: "asc" } },
  });
}

/**
 * Creates a staple reminder — ingredient + how often, nothing else. No
 * amount/quantity field: `mergeLines` (`lib/units.ts`) already treats a
 * quantity-less line as contributing nothing rather than corrupting a real
 * quantity from elsewhere, so a staple has never needed one to merge safely.
 *
 * Throws CONFLICT if this ingredient is already a staple for the household —
 * a second row for the same ingredient would double-add it whenever
 * `applyDueStaples` runs, not just create a harmless duplicate.
 */
export async function create(
  prisma: PrismaClient,
  input: { ingredientId: string; frequencyDays: number },
  actor: Actor
) {
  const existing = await prisma.stapleReminder.findFirst({
    where: { clerkOrgId: actor.clerkOrgId, ingredientId: input.ingredientId },
    select: { id: true },
  });
  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "This ingredient is already a staple.",
    });
  }

  return prisma.stapleReminder.create({
    data: {
      clerkOrgId: actor.clerkOrgId,
      ingredientId: input.ingredientId,
      frequencyDays: input.frequencyDays,
    },
    include: { ingredient: true },
  });
}

/** Throws NOT_FOUND if missing or belongs to another household. */
export async function remove(prisma: PrismaClient, id: string, actor: Actor) {
  const staple = await prisma.stapleReminder.findUnique({
    where: { id },
    select: { clerkOrgId: true },
  });
  if (!staple || staple.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await prisma.stapleReminder.delete({ where: { id } });
  return { ok: true };
}
