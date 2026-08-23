import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifyToken } from "@clerk/backend";
import { prisma } from "./prisma.js";

/**
 * The active organization id, across both Clerk session-token claim versions.
 *
 * v1 tokens carry a flat `org_id`. v2 tokens (`"v": 2`, what new instances
 * issue) drop it entirely and nest organization data under `o` as
 * `{ id, rol, slg }`. Reading only `org_id` against a v2 token yields
 * undefined, so `householdProcedure` rejects every request with
 * `FORBIDDEN: Select a household to continue` — while the frontend's
 * `useAuth().orgId` reads the same token correctly and happily lets the query
 * through. That split is what makes the failure look like a frontend bug.
 *
 * Note the role shape differs too: v1 `org_role` is `"org:admin"` where v2
 * `o.rol` is `"admin"`. Nothing reads it yet, but anything that starts to must
 * normalise both.
 */
function readOrgId(payload: Record<string, unknown>): string | null {
  const v1 = payload.org_id;
  if (typeof v1 === "string") {
    return v1;
  }

  const v2 = payload.o;
  if (v2 && typeof v2 === "object" && typeof (v2 as { id?: unknown }).id === "string") {
    return (v2 as { id: string }).id;
  }

  return null;
}

export async function createContext({ req }: CreateExpressContextOptions) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  let clerkUserId: string | null = null;
  let clerkOrgId: string | null = null;
  if (token && process.env.CLERK_SECRET_KEY) {
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });
      clerkUserId = payload.sub;
      clerkOrgId = readOrgId(payload as unknown as Record<string, unknown>);
    } catch {
      clerkUserId = null;
      clerkOrgId = null;
    }
  }

  return { prisma, clerkUserId, clerkOrgId };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
