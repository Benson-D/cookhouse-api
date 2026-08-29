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
