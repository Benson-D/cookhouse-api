import { z } from "zod";

export const mergeStoresInput = z.object({
  keepId: z.string(),
  mergeId: z.string(),
});
