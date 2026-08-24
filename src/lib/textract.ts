import { AnalyzeExpenseCommand, TextractClient, type ExpenseField } from "@aws-sdk/client-textract";
import { bucketName } from "./storage.js";

/**
 * AWS Textract client for receipt OCR.
 *
 * Reads the object straight from S3 (`S3Object: { Bucket, Name }`) rather
 * than uploading bytes again — the whole reason S3 was chosen over R2 for
 * storage. That also means this only works with a real AWS S3 bucket:
 * Textract cannot read an R2 (or other S3-compatible) object this way. If
 * storage ever moves off S3, this needs to switch to passing `Bytes` in the
 * request instead of an `S3Object` reference.
 */
// Same credentials as storage.ts's S3Client (STORAGE_* env vars) rather than
// the AWS SDK's default provider chain — this app has no shared credentials
// file or instance role to fall back to, so leaving this unset fails with
// "Could not load credentials from any providers" regardless of IAM permissions.
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

function parseDate(text: string | undefined): Date | null {
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Runs Textract's `AnalyzeExpense` — the API purpose-built for receipts and
 * invoices, as opposed to generic OCR — against an already-uploaded object.
 *
 * Synchronous: this is a network call to AWS and typically takes a few
 * seconds. Called inline from a mutation rather than queued — see root
 * CLAUDE.md ("Receipt OCR processing model") for why that's the right call
 * at this app's scale, and what would change that.
 *
 * Returns a best-effort parse: a field Textract couldn't detect comes back
 * `null` rather than throwing, since a receipt confidently missing its date
 * is still a usable result. Only a genuine API failure (bad image, Textract
 * error) throws.
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
