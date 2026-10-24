/**
 * The pure decisions of the client-side image downscale (D6 of issue 44). The browser glue in
 * `browser-image.ts` only decodes, draws and encodes; every number and every branch lives here so it is
 * unit tested. The server validates the file again, so this is a convenience, never a guarantee.
 */

/** The server limit (`MAX_IMAGE_BYTES` in the shared kernel, repeated here because that module is server-only). */
export const MAX_UPLOAD_BYTES = 500 * 1024;

/** The longest side of a downscaled image, in pixels. */
export const MAX_SIDE = 1280;

export const START_QUALITY = 0.82;
export const MIN_QUALITY = 0.4;
export const QUALITY_DECREMENT = 0.1;

export type Dimensions = { readonly width: number; readonly height: number };

/** A photo is re-encoded when it is over the byte limit or its longest side is over the pixel limit. */
export const needsDownscale = (bytes: number, size: Dimensions): boolean =>
  bytes > MAX_UPLOAD_BYTES || Math.max(size.width, size.height) > MAX_SIDE;

/** The size that keeps the aspect ratio with the longest side at most `MAX_SIDE`; never below one pixel. */
export const targetSize = (size: Dimensions): Dimensions => {
  const longest = Math.max(size.width, size.height);
  if (longest <= MAX_SIDE) return { width: size.width, height: size.height };
  const scale = MAX_SIDE / longest;
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
};

/** The next lower quality, or null once the floor is reached. Rounded so 0.82 - 0.1 is 0.72, not 0.7199999. */
export const lowerQuality = (quality: number): number | null => {
  const next = Math.round((quality - QUALITY_DECREMENT) * 100) / 100;
  return next < MIN_QUALITY ? null : next;
};

type Encoded = { readonly size: number; readonly type: string };

/**
 * Encodes at the starting quality and lowers it while the result is still over the limit. Returns null when
 * the browser cannot produce WebP (it then answers another type, or nothing), so the caller keeps the original.
 * When the floor is reached and the result is still too large, the smallest attempt is returned: the server
 * answers with the typed "too large" message.
 */
export async function encodeWithinLimit<T extends Encoded>(encode: (quality: number) => Promise<T | null>): Promise<T | null> {
  let quality: number | null = START_QUALITY;
  let last: T | null = null;
  while (quality !== null) {
    const blob = await encode(quality);
    if (blob === null || blob.type !== "image/webp") return null;
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
    last = blob;
    quality = lowerQuality(quality);
  }
  return last;
}

/** The name of the re-encoded file: the original name with a `.webp` extension. */
export const webpName = (name: string): string => {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem === "" ? "image" : stem}.webp`;
};
