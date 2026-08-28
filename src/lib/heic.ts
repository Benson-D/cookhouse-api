import jpeg from "jpeg-js";
// @ts-expect-error — libheif-js has no types for this friendlier HeifDecoder
// API, only its low-level WASM bindings.
// wasm-bundle over the plain "wasm" entry: it embeds the .wasm binary
// directly instead of loading it relative to process.cwd(), which broke
// depending on where the server was launched from.
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
 * HEIC/HEIF detection and conversion.
 *
 * Detects from actual bytes, not the declared content type — iOS Safari can
 * report a real HEIC file as image/jpeg via the file picker.
 */

/** True when `bytes` is a real HEIC/HEIF file, regardless of what it's labeled. */
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
