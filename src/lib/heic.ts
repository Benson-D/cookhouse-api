import jpeg from "jpeg-js";
// @ts-expect-error — no published types for the friendly HeifDecoder API;
// the package only ships types for the raw low-level WASM bindings, a
// different layer than what's used here. The wasm-bundle variant embeds the
// .wasm binary directly in the JS rather than loading it from a path
// relative to process.cwd(), which is how the plain "wasm" entry point does
// it — that made it fail depending on where the server process was launched
// from. Bundled avoids that entirely.
import libheif from "libheif-js/wasm-bundle";

type HeifImage = {
  get_width(): number;
  get_height(): number;
  display(
    target: { data: Uint8ClampedArray; width: number; height: number },
    callback: (result: { data: Uint8ClampedArray } | null) => void
  ): void;
};

type HeifDecoder = {
  decode(bytes: Uint8Array): HeifImage[];
};

/**
 * HEIC/HEIF detection and conversion — pure functions, no S3, no Prisma (the
 * orchestration around this — fetch from the bucket, upload the result,
 * delete the original — lives in `storage.ts`, which already owns every S3
 * operation).
 *
 * Recipe photos and receipt photos both need this: a real iPhone photo can
 * be HEIC even when labeled otherwise (iOS Safari can report a real HEIC
 * file's type as image/jpeg via the file picker), which breaks two
 * unrelated things — Textract can't read HEIC at all, and no browser except
 * Safari can render it in an <img> tag. Detecting from the actual bytes
 * catches both the honestly-labeled and the mislabeled case the same way.
 */

/**
 * True when `bytes` is a real HEIC/HEIF file, regardless of what it's
 * labeled as. HEIC is ISO-base-media-format (the same container family as
 * MP4): a "ftyp" box a few bytes in, followed by a brand code identifying
 * the specific variant.
 */
export function isHeic(bytes: Buffer): boolean {
  if (bytes.length < 12) {
    return false;
  }
  if (bytes.toString("ascii", 4, 8) !== "ftyp") {
    return false;
  }
  const brand = bytes.toString("ascii", 8, 12);
  return ["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1"].includes(
    brand
  );
}

/**
 * Decodes HEIC bytes and re-encodes as JPEG (quality 85 — a normal photo
 * quality setting, not lossless; PNG was considered and rejected here
 * specifically, since it produced a *larger* file than the original HEIC in
 * testing — the opposite of what re-encoding should do for a photo).
 *
 * Throws if the bytes aren't decodable as HEIF at all — callers should only
 * reach for this after `isHeic` confirms the format.
 */
export async function convertHeicToJpeg(bytes: Buffer): Promise<Buffer> {
  const decoder = new (libheif.HeifDecoder as new () => HeifDecoder)();
  const images = decoder.decode(bytes);
  const image = images[0];
  if (!image) {
    throw new Error("No image found in HEIC data");
  }

  const width = image.get_width();
  const height = image.get_height();

  const displayData = await new Promise<{ data: Uint8ClampedArray }>((resolve, reject) => {
    image.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (result) => {
      if (!result) {
        reject(new Error("HEIC decode failed"));
        return;
      }
      resolve(result);
    });
  });

  const encoded = jpeg.encode({ data: Buffer.from(displayData.data), width, height }, 85);
  return encoded.data;
}
