import { z } from "zod";
import { householdProcedure, router, strictRateLimit } from "../../trpc.js";
import { confirmPurchasesInput, createReceiptUploadInput, scanReceiptInput } from "./receipts.input.js";
import * as receipts from "./receipts.service.js";

const byId = z.object({ id: z.string() });

// Textract charges per call, unlike the rest of this router — 20/hour is
// generous for real shopping (nobody scans 20 receipts in an hour) but
// bounds the cost of a buggy or malicious client hammering this specific
// procedure well below what the baseline limit alone would allow.
const scanRateLimit = strictRateLimit("receipts.scan", 20, 60 * 60);

export const receiptsRouter = router({
  /** Step 1: presigned PUT for the receipt photo. */
  createUpload: householdProcedure
    .input(createReceiptUploadInput)
    .mutation(({ ctx, input }) =>
      receipts.createUpload(ctx.prisma, input.contentType, input.contentLength, ctx)
    ),

  /**
   * Step 2: creates the Receipt row and runs Textract against the uploaded
   * object. Returns parsed line items for review — nothing is committed as
   * spending yet.
   */
  scan: householdProcedure
    .use(scanRateLimit)
    .input(scanReceiptInput)
    .mutation(({ ctx, input }) => receipts.scan(ctx.prisma, input.storageKey, ctx)),

  /** Step 3: reviewed (possibly edited) line items become Purchase rows. */
  confirmPurchases: householdProcedure
    .input(confirmPurchasesInput)
    .mutation(({ ctx, input }) => receipts.confirmPurchases(ctx.prisma, input, ctx)),

  /** One receipt's photo + parsed data + the purchases it produced — the audit view. */
  getById: householdProcedure
    .input(byId)
    .query(({ ctx, input }) => receipts.getById(ctx.prisma, input.id, ctx)),

  /** Deletes the receipt and its photo; purchases it produced are detached, not deleted. */
  delete: householdProcedure
    .input(byId)
    .mutation(({ ctx, input }) => receipts.remove(ctx.prisma, input.id, ctx)),
});
