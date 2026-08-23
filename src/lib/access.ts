import { TRPCError } from "@trpc/server";
import type { PrismaClient, Role } from "@prisma/client";

// Platform-level roles (see CLAUDE.md) — distinct from Clerk's household-level
// org roles. DEVELOPER is an internal role with admin reach across households.
const ADMIN_ROLES: Role[] = ["ADMIN", "DEVELOPER"];

export async function isAdmin(prisma: PrismaClient, clerkUserId: string) {
  const user = await prisma.user.findUnique({
    where: { clerkUserId },
    select: { role: true },
  });
  return user !== null && ADMIN_ROLES.includes(user.role);
}

/**
 * Guard for household-scoped rows that record their author.
 *
 * Every member of a household can read the household's rows, but only the
 * author of a given row — or a platform admin — may change or remove it.
 * Rows belonging to another household are reported as NOT_FOUND rather than
 * FORBIDDEN, so nothing leaks about what other households have.
 */
export async function assertCanModify(
  prisma: PrismaClient,
  row: { clerkOrgId: string; createdBy: string } | null,
  actor: { clerkOrgId: string; clerkUserId: string }
) {
  if (!row || row.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  if (row.createdBy === actor.clerkUserId) {
    return;
  }
  if (await isAdmin(prisma, actor.clerkUserId)) {
    return;
  }
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Only the author or an admin can modify this",
  });
}
