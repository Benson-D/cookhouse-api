import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { getOrSync } from "../users/users.service.js";
import {
  findExisting as findExistingIngredient,
  findOrCreate as findOrCreateIngredient,
} from "../ingredients/ingredients.service.js";
import {
  buildReceiptImageKey,
  createReadUrl,
  createUploadUrl,
  deleteObject,
  ensureWebSafeImage,
  isAllowedImageType,
  keyBelongsToHouseholdReceipts,
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
  actor: Actor
) {
  if (!isAllowedImageType(contentType)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Unsupported image type: ${contentType}`,
    });
  }

  const storageKey = buildReceiptImageKey(actor.clerkOrgId, contentType);
  return { storageKey, uploadUrl: await createUploadUrl(storageKey, contentType) };
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

  return { receiptId: receipt.id, ...parsed, lineItems };
}

/** Finds a store by name, creating it if new — global, like `Ingredient` (see schema.prisma). */
async function findOrCreateStore(prisma: PrismaClient, name: string) {
  return prisma.store.upsert({ where: { name }, create: { name }, update: {} });
}

/**
 * Turns reviewed line items into `Purchase` rows — the step that actually
 * affects spending totals. Every item resolves its ingredient the same way
 * a recipe does: `ingredients.findOrCreate`, which checks `IngredientAlias`
 * first so messy receipt text ("ORG MLK 2%") converges on the same
 * `Ingredient` a recipe would use, rather than spawning a near-duplicate.
 *
 * Writes: Store (if new), Ingredient (if genuinely new), Purchase (one per
 * item), Receipt.storeId.
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

  const purchases = await Promise.all(
    input.items.map(async (item) => {
      const ingredient = await findOrCreateIngredient(prisma, item.description);
      return prisma.purchase.create({
        data: {
          clerkOrgId: actor.clerkOrgId,
          userId: user.id,
          ingredientId: ingredient.id,
          storeId: store?.id,
          receiptId: receipt.id,
          price: item.price,
          quantity: item.quantity,
          purchasedAt: input.purchasedAt ?? receipt.createdAt,
        },
      });
    })
  );

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
