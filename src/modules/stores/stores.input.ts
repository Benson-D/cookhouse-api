import { z } from "zod";

export const mergeStoresInput = z.object({
  keepId: z.string(),
  mergeId: z.string(),
});

export const searchStoresInput = z
  .object({
    search: z.string().max(100).optional(),
    take: z.number().int().positive().max(50).default(30),
  })
  .default({ take: 30 });
