import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../trpc.js";

/**
 * Tags are admin-curated (see CLAUDE.md): recipe authors attach and detach
 * existing tags on their own recipes, but only an admin may add or remove a
 * `Tag` itself, which keeps the vocabulary from fragmenting.
 *
 * No service file — each procedure is a single query. Add one if tag merging
 * or rename-with-reassign ever lands.
 */
export const tagsRouter = router({
  /** All tags, for recipe-form pickers and filter menus. */
  list: protectedProcedure.query(({ ctx }) =>
    ctx.prisma.tag.findMany({ orderBy: { name: "asc" } })
  ),

  /**
   * Writes: Tag. Throws FORBIDDEN for non-admins, CONFLICT if the name is
   * taken (`Tag.name` is unique).
   */
  create: adminProcedure
    .input(z.object({ name: z.string().min(1), type: z.string().optional() }))
    .mutation(({ ctx, input }) => ctx.prisma.tag.create({ data: input })),

  /**
   * Writes: Tag, and cascades to RecipeTag — deleting a tag detaches it from
   * every recipe that used it rather than being blocked by them.
   * Throws FORBIDDEN for non-admins.
   */
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.tag.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
