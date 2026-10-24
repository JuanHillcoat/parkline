/**
 * Thin browser glue around the decisions of `image-downscale.ts`: decode the chosen file, draw it smaller on a
 * canvas and encode it as WebP. Every failure (a file the browser cannot decode, no canvas, no WebP encoder)
 * returns the original file, so the server's validation answers instead of the page failing.
 */
import { encodeWithinLimit, needsDownscale, targetSize, webpName, type Dimensions } from "./image-downscale";

async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

function drawn(bitmap: ImageBitmap, size: Dimensions): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return canvas;
}

const encoderOf = (canvas: HTMLCanvasElement) => (quality: number) =>
  new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });

async function reencode(file: File, bitmap: ImageBitmap): Promise<File> {
  const canvas = drawn(bitmap, targetSize(bitmap));
  const blob = canvas === null ? null : await encodeWithinLimit(encoderOf(canvas));
  if (blob === null || blob.size >= file.size) return file;
  return new File([blob], webpName(file.name), { type: "image/webp" });
}

/** The file to upload: the original when it is small enough, a smaller WebP otherwise. */
export async function downscaleImage(file: File): Promise<File> {
  const bitmap = await decode(file);
  if (bitmap === null) return file;
  try {
    return needsDownscale(file.size, bitmap) ? await reencode(file, bitmap) : file;
  } finally {
    bitmap.close();
  }
}

/** Puts `file` in the input, so the form submits the downscaled file instead of the original. */
export function replaceInputFile(input: HTMLInputElement, file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
}
