import { initTRPC, TRPCError } from "@trpc/server";
import { RateLimiterMemory } from "rate-limiter-flexible";
import type { Context } from "./context.js";
import { isAdmin } from "./lib/access.js";
import { isWithinLimit } from "./lib/rateLimit.js";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

const RATE_LIMIT_ERROR = new TRPCError({
  code: "TOO_MANY_REQUESTS",
  message: "Too many requests — please slow down and try again shortly.",
});

// Generous baseline on every authenticated call, keyed per user — stops a
// runaway or scripted client from hammering any endpoint indefinitely.
// 100/minute is well above normal interactive use.
const baselineLimiter = new RateLimiterMemory({ points: 100, duration: 60 });

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.clerkUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  if (!(await isWithinLimit(baselineLimiter, ctx.clerkUserId))) {
    throw RATE_LIMIT_ERROR;
  }
  return next({ ctx: { ...ctx, clerkUserId: ctx.clerkUserId } });
});

/**
 * A named, stricter limit to layer on top of the baseline via
 * `.use(strictRateLimit(...))`. The `clerkUserId` check below is defensive,
 * not the primary auth gate — this middleware's own type can't see that a
 * caller already narrowed it.
 */
export function strictRateLimit(name: string, points: number, durationSeconds: number) {
  const limiter = new RateLimiterMemory({ points, duration: durationSeconds, keyPrefix: name });
  return t.middleware(async ({ ctx, next }) => {
    // Defensive narrowing, then the actual budget check.
    if (!ctx.clerkUserId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!(await isWithinLimit(limiter, ctx.clerkUserId))) {
      throw RATE_LIMIT_ERROR;
    }
    return next();
  });
}

// Requires an active Clerk Organization, not just a signed-in user — most of
// this API is scoped to a household.
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
