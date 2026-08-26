import { householdProcedure, router } from "../../trpc.js";
import { byIdInput, createStapleInput } from "./staples.input.js";
import * as staples from "./staples.service.js";

/**
 * Staples are household state, like the grocery list itself — no author
 * checks, any member can create or remove one. `applyDueStaples`
 * (`grocery-lists.service.ts`) is the only thing that ever writes
 * `lastAddedAt`; nothing here touches it.
 */
export const staplesRouter = router({
  list: householdProcedure.query(({ ctx }) => staples.list(ctx.prisma, ctx)),

  create: householdProcedure
    .input(createStapleInput)
    .mutation(({ ctx, input }) => staples.create(ctx.prisma, input, ctx)),

  delete: householdProcedure
    .input(byIdInput)
    .mutation(({ ctx, input }) => staples.remove(ctx.prisma, input.id, ctx)),
});
