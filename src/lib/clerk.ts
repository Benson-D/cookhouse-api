import { createClerkClient } from "@clerk/backend";

/**
 * Clerk Backend SDK client, for reading identity Clerk owns (profile fields,
 * org membership) that our DB only mirrors.
 *
 * Separate from token *verification* in `context.ts`, which needs no client.
 */
export const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY ?? "",
});
