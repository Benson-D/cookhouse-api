import { AnalyzeExpenseCommand, TextractClient, type ExpenseField } from "@aws-sdk/client-textract";
import { bucketName } from "./storage.js";

/**
 * AWS Textract client for receipt OCR. Reads the object straight from S3 by
 * reference (`S3Object: { Bucket, Name }`), not by uploading bytes — so this
 * only works against a real S3 bucket, not R2 or another S3-compatible one.
 */
// Explicit STORAGE_* credentials, not the SDK's default provider chain —
// there's no shared credentials file or instance role here to fall back to.
const client = new TextractClient({
  region: process.env.STORAGE_REGION || "us-east-2",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
  },
});

export type ParsedReceiptLineItem = {
  description: string;
  price: number | null;
  quantity: number | null;
};

export type ParsedReceipt = {
  vendorName: string | null;
  total: number | null;
  purchasedAt: Date | null;
  lineItems: ParsedReceiptLineItem[];
};

/** Looks up one summary field by its `Type` name (e.g. "TOTAL") — Textract returns these as an array, not a keyed object. */
function findField(fields: ExpenseField[] | undefined, type: string): string | undefined {
  return fields?.find((field) => field.Type?.Text === type)?.ValueDetection?.Text;
}

/** Strips currency symbols/commas; returns null rather than NaN on unparseable text. */
function parseNumber(text: string | undefined): number | null {
  if (!text) {
    return null;
  }
  const value = Number.parseFloat(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** Returns null rather than an Invalid Date on unparseable text. */
function parseDate(text: string | undefined): Date | null {
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Runs Textract's `AnalyzeExpense` — purpose-built for receipts, not generic
 * OCR — against an already-uploaded object.
 *
 * Best-effort: a field Textract can't detect comes back `null` rather than
 * throwing. Only a genuine API failure throws.
 */
export async function analyzeReceipt(storageKey: string): Promise<ParsedReceipt> {
  const response = await client.send(
    new AnalyzeExpenseCommand({
      Document: { S3Object: { Bucket: bucketName(), Name: storageKey } },
    })
  );

  const doc = response.ExpenseDocuments?.[0];
  if (!doc) {
    return { vendorName: null, total: null, purchasedAt: null, lineItems: [] };
  }

  // Flattened — Textract nests items under groups, but a receipt has no real subgroups to preserve.
  const lineItems: ParsedReceiptLineItem[] = [];
  for (const group of doc.LineItemGroups ?? []) {
    for (const item of group.LineItems ?? []) {
      const description = findField(item.LineItemExpenseFields, "ITEM");
      if (!description) {
        continue; // Textract found a row but couldn't read what it was — nothing usable to keep.
      }
      lineItems.push({
        description,
        price: parseNumber(findField(item.LineItemExpenseFields, "PRICE")),
        quantity: parseNumber(findField(item.LineItemExpenseFields, "QUANTITY")),
      });
    }
  }

  return {
    vendorName: findField(doc.SummaryFields, "VENDOR_NAME") ?? null,
    total: parseNumber(findField(doc.SummaryFields, "TOTAL")),
    purchasedAt: parseDate(findField(doc.SummaryFields, "INVOICE_RECEIPT_DATE")),
    lineItems,
  };
}
