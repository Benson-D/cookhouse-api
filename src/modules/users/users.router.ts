import { protectedProcedure, router } from "../../trpc.js";
import * as users from "./users.service.js";

export const usersRouter = router({
  /** Current user's local profile, created from Clerk on first call. */
  me: protectedProcedure.query(({ ctx }) =>
    users.getOrSync(ctx.prisma, ctx.clerkUserId)
  ),
});
