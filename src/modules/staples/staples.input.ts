import { z } from "zod";

export const createStapleInput = z.object({
  ingredientId: z.string(),
  frequencyDays: z.number().int().positive(),
});

export const byIdInput = z.object({ id: z.string() });
