import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { convertHeicToJpeg, isHeic } from "./heic.js";

/**
 * Object storage, written against the S3 API so the provider stays a config
 * choice. Cloudflare R2, Backblaze B2 and AWS S3 all speak this protocol —
 * point `STORAGE_ENDPOINT` at the provider (omit it for AWS) and nothing here
 * changes.
 *
 * Uploads never pass through this server. A procedure hands the client a
 * presigned PUT, the client sends the bytes straight to the bucket, then a
 * second procedure records the key. That keeps large files off the Node
 * process, needs no multipart parsing or temp files, and works identically
 * from a future mobile client.
 */

const UPLOAD_URL_TTL_SECONDS = 60 * 5;
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/** Generous cap for one photo — real phone photos rarely get close to this even before HEIC conversion. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Content types accepted for photo uploads, mapped to their extension. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/heic": "heic",
};

export function isAllowedImageType(contentType: string): boolean {
  return contentType in IMAGE_EXTENSIONS;
}

export function allowedImageTypes(): string[] {
  return Object.keys(IMAGE_EXTENSIONS);
}

/**
 * Builds the object key for a recipe photo.
 *
 * The extension comes from the declared content type, never from a
 * user-supplied filename, and the basename is a fresh UUID — an uploaded name
 * is untrusted input and has no reason to reach the bucket.
 *
 * Keys are prefixed by household so one household's objects can be listed or
 * purged without touching another's.
 */
export function buildRecipeImageKey(
  clerkOrgId: string,
  recipeId: string,
  contentType: string
): string {
  const extension = IMAGE_EXTENSIONS[contentType];
  if (!extension) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }
  return `recipes/${clerkOrgId}/${recipeId}/${randomUUID()}.${extension}`;
}

/** True when `key` sits under the prefix owned by this household + recipe. */
export function keyBelongsToRecipe(
  key: string,
  clerkOrgId: string,
  recipeId: string
): boolean {
  return key.startsWith(`recipes/${clerkOrgId}/${recipeId}/`);
}

/**
 * Builds the object key for a receipt photo.
 *
 * No recipeId-style entity to scope under here — unlike a recipe, a receipt
 * doesn't exist yet at upload time; the photo *is* the starting point, so the
 * `Receipt` row is only created once scanning begins, keyed off this object.
 */
export function buildReceiptImageKey(clerkOrgId: string, contentType: string): string {
  const extension = IMAGE_EXTENSIONS[contentType];
  if (!extension) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }
  return `receipts/${clerkOrgId}/${randomUUID()}.${extension}`;
}

/** True when `key` sits under the prefix owned by this household's receipts. */
export function keyBelongsToHouseholdReceipts(key: string, clerkOrgId: string): boolean {
  return key.startsWith(`receipts/${clerkOrgId}/`);
}

type StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Base URL for public reads; when unset, reads are presigned instead. */
  publicUrl?: string;
};

let cached: { config: StorageConfig; client: S3Client } | null = null;

/**
 * Reads storage config from the environment on first use.
 *
 * Deliberately lazy: the server must boot and serve every non-image route
 * with storage unconfigured, so this throws only when an upload is actually
 * attempted.
 */
function storage() {
  if (cached) {
    return cached;
  }

  const config: StorageConfig = {
    bucket: process.env.STORAGE_BUCKET ?? "",
    region: process.env.STORAGE_REGION ?? "auto",
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? "",
    publicUrl: process.env.STORAGE_PUBLIC_URL || undefined,
  };

  const missing = (["bucket", "accessKeyId", "secretAccessKey"] as const).filter(
    (key) => !config[key]
  );
  if (missing.length > 0) {
    throw new Error(
      `Object storage is not configured — set STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID and STORAGE_SECRET_ACCESS_KEY (missing: ${missing.join(", ")})`
    );
  }

  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    // R2 and most S3-compatible providers require path-style addressing.
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  cached = { config, client };
  return cached;
}

/** The configured bucket name — for callers (Textract) that need to reference an object directly rather than via a presigned URL. */
export function bucketName(): string {
  return storage().config.bucket;
}

/**
 * Presigned PUT the client uploads to directly. Short-lived by design.
 *
 * Signs `ContentLength` along with the key and type, so S3 checks the
 * actual upload's size against it — a client can't request a URL for a
 * small file and then send more bytes than declared. Not yet verified
 * against a real bucket (see `cookhouse-api/CLAUDE.md`'s Storage section);
 * the caller-side cap (`MAX_UPLOAD_BYTES`, checked before this is ever
 * called) is the layer that's certain to hold regardless.
 */
export function createUploadUrl(key: string, contentType: string, contentLength: number) {
  const { client, config } = storage();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS }
  );
}

/**
 * A URL the client can read the object from — the public CDN URL when the
 * bucket is served publicly, otherwise a presigned GET.
 */
export function createReadUrl(key: string): Promise<string> {
  const { client, config } = storage();
  if (config.publicUrl) {
    return Promise.resolve(`${config.publicUrl.replace(/\/$/, "")}/${key}`);
  }
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn: DOWNLOAD_URL_TTL_SECONDS,
  });
}

/** Deletes an object from the bucket. */
export async function deleteObject(key: string): Promise<void> {
  const { client, config } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}

/** Fetches an object's bytes directly — for server-side processing, not client downloads. */
async function getObjectBytes(key: string): Promise<Buffer> {
  const { client, config } = storage();
  const response = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error(`Object has no body: ${key}`);
  }
  return Buffer.from(bytes);
}

/** Writes bytes directly — for server-generated content, not client uploads (those go through `createUploadUrl`). */
async function putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
  const { client, config } = storage();
  await client.send(
    new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: contentType })
  );
}

/**
 * Converts `key` to JPEG if it's actually HEIC, replacing the stored object;
 * otherwise returns `key` unchanged.
 *
 * Checks the real bytes, not the declared content type — iOS Safari can
 * report a genuine HEIC file as image/jpeg through the file picker.
 */
export async function ensureWebSafeImage(key: string): Promise<string> {
  const original = await getObjectBytes(key);
  if (!isHeic(original)) {
    return key;
  }

  const converted = await convertHeicToJpeg(original);
  const newKey = key.replace(/\.[^./]+$/, ".jpg");
  await putObject(newKey, converted, "image/jpeg");
  await deleteObject(key);
  return newKey;
}
