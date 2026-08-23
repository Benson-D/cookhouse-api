import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

/** Presigned PUT the client uploads to directly. Short-lived by design. */
export function createUploadUrl(key: string, contentType: string) {
  const { client, config } = storage();
  return getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType,
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

export async function deleteObject(key: string): Promise<void> {
  const { client, config } = storage();
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
}
