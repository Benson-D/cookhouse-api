import { publicProcedure, router } from "./trpc.js";
import { usersRouter } from "./modules/users/users.router.js";
import { recipesRouter } from "./modules/recipes/recipes.router.js";
import { groceryListsRouter } from "./modules/grocery-lists/grocery-lists.router.js";
import { ingredientsRouter } from "./modules/ingredients/ingredients.router.js";
import { tagsRouter } from "./modules/tags/tags.router.js";
import { unitsRouter } from "./modules/units/units.router.js";
import { receiptsRouter } from "./modules/receipts/receipts.router.js";
import { spendingRouter } from "./modules/spending/spending.router.js";
import { staplesRouter } from "./modules/staples/staples.router.js";

export const appRouter = router({
  /** Unauthenticated liveness check. */
  health: publicProcedure.query(() => ({ ok: true, timestamp: Date.now() })),

  users: usersRouter,
  recipes: recipesRouter,
  groceryLists: groceryListsRouter,
  ingredients: ingredientsRouter,
  tags: tagsRouter,
  units: unitsRouter,
  receipts: receiptsRouter,
  spending: spendingRouter,
  staples: staplesRouter,
});

export type AppRouter = typeof appRouter;
