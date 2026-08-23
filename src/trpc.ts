import { initTRPC, TRPCError } from "@trpc/server";
import type { Context } from "./context.js";
import { isAdmin } from "./lib/access.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, clerkUserId: ctx.clerkUserId } });
});

// Household-scoped data (recipes, grocery lists, purchases, ...) needs an
// active Clerk Organization on the session, not just a signed-in user.
export const householdProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.clerkOrgId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Select a household to continue",
    });
  }
  return next({ ctx: { ...ctx, clerkOrgId: ctx.clerkOrgId } });
});

// Platform-level Role (CLIENT/ADMIN/DEVELOPER), separate from Clerk's
// household-level org roles — e.g. Tag creation/deletion is admin-curated.
export const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!(await isAdmin(ctx.prisma, ctx.clerkUserId))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return next({ ctx });
});
