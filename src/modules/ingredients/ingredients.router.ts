import { z } from "zod";
import { protectedProcedure, router } from "../../trpc.js";
import * as ingredients from "./ingredients.service.js";

export const ingredientsRouter = router({
  /** Search the shared ingredient list (for recipe-form autocomplete). */
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().max(100).optional(),
          take: z.number().int().positive().max(50).default(30),
        })
        .default({ take: 30 })
    )
    .query(({ ctx, input }) => ingredients.list(ctx.prisma, input.search, input.take)),

  /** Resolve a typed name to its canonical ingredient, creating it if new. */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1), category: z.string().optional() }))
    .mutation(({ ctx, input }) =>
      ingredients.findOrCreate(ctx.prisma, input.name, input.category)
    ),
});
