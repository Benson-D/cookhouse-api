import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { getOrSync } from "../users/users.service.js";
import {
  findExisting as findExistingIngredient,
  findOrCreateIfRecognized,
} from "../ingredients/ingredients.service.js";
import { checkOffPurchase } from "../grocery-lists/grocery-lists.service.js";
import {
  buildReceiptImageKey,
  createReadUrl,
  createUploadUrl,
  deleteObject,
  ensureWebSafeImage,
  isAllowedImageType,
  keyBelongsToHouseholdReceipts,
  MAX_UPLOAD_BYTES,
} from "../../lib/storage.js";
import { analyzeReceipt } from "../../lib/textract.js";
import type { ConfirmPurchasesInput } from "./receipts.input.js";

type Actor = { clerkOrgId: string; clerkUserId: string };

/**
 * Issues a presigned PUT for a receipt photo.
 *
 * Unlike a recipe photo, there's no existing entity to check permission
 * against yet — a receipt doesn't exist until scanning starts, so the only
 * gate here is having an active household at all (already enforced by
 * `householdProcedure`).
 *
 * Same allowlist as recipe photos, including HEIC — unlike an earlier
 * version of this function, HEIC is no longer rejected here. `scan` now
 * converts it transparently via `ensureWebSafeImage`, so rejecting it
 * upfront would only be turning away something that already works.
 *
 * Writes nothing. See `scan` for where the `Receipt` row actually gets
 * created.
 */
export async function createUpload(
  prisma: PrismaClient,
  contentType: string,
  contentLength: number,
  actor: Actor
) {
  if (!isAllowedImageType(contentType)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unsupported image type: ${contentType}`,
    });
  }
  if (contentLength > MAX_UPLOAD_BYTES) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Image is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`,
    });
  }

  const storageKey = buildReceiptImageKey(actor.clerkOrgId, contentType);
  return {
    storageKey,
    uploadUrl: await createUploadUrl(storageKey, contentType, contentLength),
  };
}

/**
 * Creates the `Receipt` row and runs Textract against the uploaded object,
 * synchronously. Converts the image to JPEG first if it's actually HEIC
 * (regardless of its declared type), so Textract always gets a readable
 * image. A Textract failure still leaves the `Receipt` row (status `failed`)
 * rather than losing the upload. Each line item is annotated with whether it
 * matches an existing `Ingredient`/`IngredientAlias` (exact match only), so
 * the review screen can tell new items from matched ones before anything
 * commits. Returns the parsed items, unwritten, plus a renderable `imageUrl`
 * for the converted image.
 *
 * Throws BAD_REQUEST if the key doesn't belong to this household's receipts.
 */
export async function scan(prisma: PrismaClient, storageKey: string, actor: Actor) {
  if (!keyBelongsToHouseholdReceipts(storageKey, actor.clerkOrgId)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Key does not belong to this household" });
  }

  const user = await getOrSync(prisma, actor.clerkUserId);

  let webSafeKey: string;
  try {
    webSafeKey = await ensureWebSafeImage(storageKey);
  } catch (error) {
    console.error(`HEIC conversion failed for upload ${storageKey}:`, error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Couldn't process this photo — try a different one.",
    });
  }

  const receipt = await prisma.receipt.create({
    data: {
      clerkOrgId: actor.clerkOrgId,
      userId: user.id,
      imageS3Key: webSafeKey,
      status: "processing",
    },
  });

  let parsed;
  try {
    parsed = await analyzeReceipt(webSafeKey);
  } catch (error) {
    // Swallowed for the client (a raw AWS error isn't a useful message to
    // show), but logged for real — losing this entirely turns every Textract
    // failure (bad credentials, IAM, a genuinely unreadable image) into the
    // same unhelpful dead end server-side.
    console.error(`Textract failed for receipt ${receipt.id}:`, error);
    await prisma.receipt.update({ where: { id: receipt.id }, data: { status: "failed" } });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Couldn't read this receipt — try a clearer photo.",
    });
  }

  await prisma.receipt.update({
    where: { id: receipt.id },
    data: { status: "parsed", rawOcrText: JSON.stringify(parsed) },
  });

  const lineItems = await Promise.all(
    parsed.lineItems.map(async (item) => {
      const match = await findExistingIngredient(prisma, item.description);
      return {
        ...item,
        matchedIngredientId: match?.id ?? null,
        matchedIngredientName: match?.name ?? null,
      };
    })
  );

  return {
    receiptId: receipt.id,
    ...parsed,
    lineItems,
    imageUrl: await createReadUrl(webSafeKey),
  };
}

/**
 * Finds a store by name, creating it if new — global, like `Ingredient` (see
 * schema.prisma). Stored uppercased, not lowercased like Ingredient — same
 * reasoning either way: normalizing on write is what lets the exact-match
 * upsert catch "Whole Foods" vs. "WHOLE FOODS" as one row instead of two.
 */
async function findOrCreateStore(prisma: PrismaClient, name: string) {
  const normalized = name.trim().toUpperCase();
  return prisma.store.upsert({ where: { name: normalized }, create: { name: normalized }, update: {} });
}

/**
 * Resolves a scanned line's ingredient without inventing a fake one. Checks
 * `IngredientAlias`/exact name first; a miss only creates a new `Ingredient`
 * when `categorize()` confidently recognizes it, otherwise stores the text
 * as a lowercased `label`.
 */
async function resolvePurchaseItem(prisma: PrismaClient, description: string) {
  const ingredient = await findOrCreateIfRecognized(prisma, description);
  return ingredient
    ? { ingredientId: ingredient.id, label: null }
    : { ingredientId: null, label: description.trim().toLowerCase() };
}

/**
 * Turns reviewed line items into `Purchase` rows — the step that actually
 * affects spending totals. Also checks each item off the active grocery
 * list, or adds it already checked if it wasn't there.
 *
 * Writes: Store (if new), Ingredient (only when genuinely new and
 * confidently categorized), Purchase (one per item), GroceryListItem
 * (checked or created), Receipt.storeId.
 * Throws NOT_FOUND if the receipt is missing or belongs to another household.
 */
export async function confirmPurchases(
  prisma: PrismaClient,
  input: ConfirmPurchasesInput,
  actor: Actor
) {
  const receipt = await prisma.receipt.findUnique({ where: { id: input.receiptId } });
  if (!receipt || receipt.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  const user = await getOrSync(prisma, actor.clerkUserId);
  const store = input.storeName ? await findOrCreateStore(prisma, input.storeName) : null;

  // Sequential, not Promise.all — only prevents two lines on this one
  // receipt from double-creating a row; the broader cross-request race
  // is unchanged.
  const purchases = [];
  for (const item of input.items) {
    const { ingredientId, label } = await resolvePurchaseItem(prisma, item.description);
    const purchase = await prisma.purchase.create({
      data: {
        clerkOrgId: actor.clerkOrgId,
        userId: user.id,
        ingredientId,
        label,
        storeId: store?.id,
        receiptId: receipt.id,
        price: item.price,
        quantity: item.quantity,
        purchasedAt: input.purchasedAt ?? receipt.createdAt,
      },
    });
    purchases.push(purchase);
    await checkOffPurchase(prisma, actor, { ingredientId, label, quantity: item.quantity ?? null });
  }

  if (store) {
    await prisma.receipt.update({ where: { id: receipt.id }, data: { storeId: store.id } });
  }

  return { purchases, storeId: store?.id ?? null };
}

/**
 * One receipt, with a renderable URL for its photo and the purchases it
 * produced — the audit view for when a spending number looks wrong: trace it
 * back to what Textract actually read off the original image.
 *
 * Throws NOT_FOUND if missing or belongs to another household.
 */
export async function getById(prisma: PrismaClient, id: string, actor: Actor) {
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    include: { store: true, purchases: { include: { ingredient: true } } },
  });
  if (!receipt || receipt.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return { ...receipt, imageUrl: await createReadUrl(receipt.imageS3Key) };
}

/**
 * Deletes a receipt and its photo. Purchases it produced are detached, not
 * deleted (`Purchase.receiptId` set null), so cleanup never erases spending
 * history — including a duplicate scan's purchases, which stay counted.
 *
 * Throws NOT_FOUND if missing or belongs to another household.
 */
export async function remove(prisma: PrismaClient, id: string, actor: Actor) {
  const receipt = await prisma.receipt.findUnique({
    where: { id },
    select: { clerkOrgId: true, imageS3Key: true },
  });
  if (!receipt || receipt.clerkOrgId !== actor.clerkOrgId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  await prisma.$transaction([
    prisma.purchase.updateMany({ where: { receiptId: id }, data: { receiptId: null } }),
    prisma.receipt.delete({ where: { id } }),
  ]);

  await deleteObject(receipt.imageS3Key).catch(() => {
    // Orphaned object; the row is already gone, which is the state that matters.
  });

  return { ok: true };
}
