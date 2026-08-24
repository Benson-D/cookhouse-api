import { z } from "zod";

export const createReceiptUploadInput = z.object({
  contentType: z.string(),
});

export const scanReceiptInput = z.object({
  storageKey: z.string(),
});

const confirmedLineItem = z.object({
  description: z.string().min(1),
  price: z.number(),
  quantity: z.number().positive().optional(),
});

/**
 * What actually gets written as `Purchase` rows — the line items Textract
 * found, as reviewed and possibly corrected by the user. Nothing is
 * committed from `scan` alone; this is the second, deliberate step.
 */
export const confirmPurchasesInput = z.object({
  receiptId: z.string(),
  storeName: z.string().min(1).optional(),
  purchasedAt: z.coerce.date().optional(),
  items: z.array(confirmedLineItem).min(1),
});

export type ConfirmPurchasesInput = z.infer<typeof confirmPurchasesInput>;
