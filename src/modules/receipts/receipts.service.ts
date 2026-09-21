import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { getOrSync } from "../users/users.service.js";
import { findExisting as findExistingIngredient } from "../ingredients/ingredients.service.js";
import { checkOffPurchase } from "../grocery-lists/grocery-lists.service.js";
import { categorize } from "../../lib/categorize.js";
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
 * synchronously — see root CLAUDE.md ("Receipt OCR processing model") for
 * why this isn't queued.
 *
 * Nothing beyond the `Receipt` row itself is written here: the parsed line
 * items are returned to the caller for review, not turned into `Purchase`
 * rows until `confirmPurchases`. A Textract failure still leaves a `Receipt`
 * row (status `failed`) rather than silently losing the upload.
 *
 * Runs `ensureWebSafeImage` first — if the uploaded object turns out to
 * actually be HEIC (regardless of what it was labeled as; iOS Safari can
 * report a real HEIC file's type as image/jpeg via the file picker), it's
 * converted to JPEG and re-stored before Textract ever sees it, and the
 * `Receipt` row points at the converted object from the start. That's what
 * keeps this reliably synchronous rather than needing a try-Textract,
 * catch-and-retry dance.
 *
 * Each line item is also checked against `Ingredient`/`IngredientAlias` —
 * read-only, via `ingredients.findExisting` — and annotated with what it
 * matched, if anything. This is what lets a review screen tell "new
 * ingredient" lines apart from ones that already resolve to something, before
 * `confirmPurchases` commits anything. There's no fuzzy/low-confidence tier:
 * matching here is exact name or exact alias, same as everywhere else in this
 * codebase — a line either matches or it's new, nothing in between yet.
 *
 * The response also includes `imageUrl` (the converted object's real,
 * renderable URL) so the review screen can swap away from a local
 * `URL.createObjectURL(file)` preview of the *original* picked file once
 * this resolves — that local preview is still raw HEIC bytes if that's what
 * was picked, and no browser but Safari can render those. `ensureWebSafeImage`
 * fixes the *stored* image; this is what lets the caller stop showing the
 * unfixed one.
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
 * Resolves a scanned line's ingredient without ever inventing a fake one.
 * Checks `IngredientAlias`/exact name first (same lookup a recipe uses), so
 * messy receipt text ("ORG MLK 2%") converges on an existing `Ingredient`
 * rather than spawning a near-duplicate. A miss only creates a new
 * `Ingredient` when `categorize()` confidently recognizes it (food,
 * household, alcohol — whatever it is, it's a real thing); anything it
 * can't place — a brand name, garbled OCR — becomes a plain label instead,
 * never a permanent row nobody asked for.
 */
async function resolvePurchaseItem(prisma: PrismaClient, description: string) {
  const existing = await findExistingIngredient(prisma, description);
  if (existing) {
    return { ingredientId: existing.id, label: null };
  }

  const category = categorize(description);
  if (category) {
    // upsert, not create — two concurrent scans resolving the same new name
    // converge on one row instead of colliding on the unique constraint.
    const normalized = description.trim().toLowerCase();
    const created = await prisma.ingredient.upsert({
      where: { name: normalized },
      create: { name: normalized, category },
      update: {},
    });
    return { ingredientId: created.id, label: null };
  }

  return { ingredientId: null, label: description.trim() };
}

/**
 * Turns reviewed line items into `Purchase` rows — the step that actually
 * affects spending totals. Also checks each item off the active grocery
 * list (or adds it, already checked, if it wasn't there) — see
 * grocery-lists.service.ts's checkOffPurchase for the matching rules.
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

  // Sequential, not Promise.all — avoids two identical line items on this
  // one receipt racing each other into a double-created row. Doesn't fix
  // the broader cross-request race (GroceryListItem has no unique
  // constraint on listId+ingredientId — see root CLAUDE.md); that gap is
  // unchanged by this.
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
 * Deletes a receipt and its photo. Purchases it produced are **detached, not
 * deleted** — `Purchase.receiptId` is set null rather than the rows being
 * removed, so a receipt cleanup can never silently erase real spending
 * history. Matches the org-departure retention rule elsewhere in this app:
 * detach the link, keep the record.
 *
 * One consequence worth knowing: this doesn't fully clean up a duplicate
 * scan — deleting the extra receipt leaves its (also duplicate) purchases in
 * place, still counted in spending totals. There's no per-purchase delete
 * yet; that's a deliberate, separate gap, not an oversight here.
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
