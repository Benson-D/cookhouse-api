import { householdProcedure, router } from "../../trpc.js";
import {
  addFromRecipesInput,
  addItemInput,
  byItemIdInput,
  historyInput,
  setCheckedInput,
} from "./grocery-lists.input.js";
import * as lists from "./grocery-lists.service.js";

/**
 * Shared household state — every procedure is household-scoped and none check
 * authorship, unlike recipes. A list belongs to the household, not its author.
 */
export const groceryListsRouter = router({
  /** Current list, created on first access; adds any staples now due. */
  getActive: householdProcedure.query(({ ctx }) => lists.getActive(ctx.prisma, ctx)),

  /** Merge the ingredients of one or more recipes into the active list. */
  addFromRecipes: householdProcedure
    .input(addFromRecipesInput)
    .mutation(({ ctx, input }) =>
      lists.addFromRecipes(ctx.prisma, input.recipeIds, ctx)
    ),

  addItem: householdProcedure
    .input(addItemInput)
    .mutation(({ ctx, input }) => lists.addItem(ctx.prisma, input, ctx)),

  setChecked: householdProcedure
    .input(setCheckedInput)
    .mutation(({ ctx, input }) =>
      lists.setChecked(ctx.prisma, input.itemId, input.checked, ctx)
    ),

  removeItem: householdProcedure
    .input(byItemIdInput)
    .mutation(({ ctx, input }) => lists.removeItem(ctx.prisma, input.itemId, ctx)),

  /** Archive the active list; the next getActive starts a fresh one. */
  complete: householdProcedure.mutation(({ ctx }) => lists.complete(ctx.prisma, ctx)),

  /** Delete every item on the active list; the list itself stays active. */
  removeAll: householdProcedure.mutation(({ ctx }) => lists.removeAll(ctx.prisma, ctx)),

  /** Past lists, newest first. */
  history: householdProcedure
    .input(historyInput)
    .query(({ ctx, input }) => lists.history(ctx.prisma, input, ctx)),
});
