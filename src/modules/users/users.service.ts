import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { clerkClient } from "../../lib/clerk.js";

/**
 * Returns the local `User` row for a Clerk identity, creating it on first
 * sight by copying the profile from Clerk.
 *
 * Clerk owns identity; our `User` table only mirrors the fields the app needs
 * (and anchors FKs for favorites, purchases, receipts). Nothing else writes
 * that row, so every authenticated entry point must come through here or the
 * user will appear to have no account.
 *
 * Writes: User (create on first call, profile refresh on later ones).
 * Throws NOT_FOUND if Clerk has no such user, or if the profile has no email
 * address — `User.email` is non-null and unique, so there is nothing to store.
 */
export async function getOrSync(prisma: PrismaClient, clerkUserId: string) {
  const existing = await prisma.user.findUnique({ where: { clerkUserId } });
  if (existing) {
    return existing;
  }

  const clerkUser = await clerkClient.users.getUser(clerkUserId).catch(() => null);
  if (!clerkUser) {
    throw new TRPCError({ code: "NOT_FOUND", message: "No such Clerk user" });
  }

  const email = clerkUser.emailAddresses.find(
    (address) => address.id === clerkUser.primaryEmailAddressId
  )?.emailAddress;
  if (!email) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Clerk user has no primary email address",
    });
  }

  // upsert, not create: two concurrent first requests would otherwise race and
  // one would fail the unique constraint on clerkUserId.
  return prisma.user.upsert({
    where: { clerkUserId },
    create: {
      clerkUserId,
      email,
      firstName: clerkUser.firstName,
      lastName: clerkUser.lastName,
      imageUrl: clerkUser.imageUrl,
    },
    update: {},
  });
}
