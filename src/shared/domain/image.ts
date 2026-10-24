import { createHash } from "node:crypto";
import { ValidationError } from "./domain-error";
import { err, ok, type Result } from "./result";

/** The largest image the application stores: 500 KB (free-tier storage, ADR-0008). */
export const MAX_IMAGE_BYTES = 500 * 1024;

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

/** A validated image: the type comes from the bytes, never from a declared type or a file name. */
export type ImageFile = {
  readonly contentType: ImageContentType;
  readonly byteSize: number;
  readonly data: Uint8Array;
};

export class ImageEmptyError extends ValidationError {
  readonly code: string = "image_empty";

  constructor() {
    super("The image file is empty", "image");
  }
}

export class ImageTooLargeError extends ValidationError {
  readonly code: string = "image_too_large";

  constructor() {
    super(`The image is larger than ${String(MAX_IMAGE_BYTES)} bytes`, "image");
  }
}

export class ImageUnsupportedTypeError extends ValidationError {
  readonly code: string = "image_unsupported_type";

  constructor() {
    super("The image must be a JPEG, PNG or WebP file", "image");
  }
}

export type ImageError = ImageEmptyError | ImageTooLargeError | ImageUnsupportedTypeError;

const startsWith = (bytes: Uint8Array, magic: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + magic.length && magic.every((value, index) => bytes[offset + index] === value);

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** WebP is a RIFF container: "RIFF", a four byte size, then "WEBP". */
const isWebp = (bytes: Uint8Array): boolean => startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8);

const detect = (bytes: Uint8Array): ImageContentType | null => {
  if (startsWith(bytes, JPEG)) return "image/jpeg";
  if (startsWith(bytes, PNG)) return "image/png";
  return isWebp(bytes) ? "image/webp" : null;
};

/**
 * Validates an uploaded file by its content only. Empty and oversized files are refused before the type is
 * looked at; anything that is not a JPEG, PNG or WebP (SVG and GIF included) is an unsupported type.
 */
export const parseImage = (bytes: Uint8Array): Result<ImageFile, ImageError> => {
  if (bytes.length === 0) return err(new ImageEmptyError());
  if (bytes.length > MAX_IMAGE_BYTES) return err(new ImageTooLargeError());
  const contentType = detect(bytes);
  return contentType === null ? err(new ImageUnsupportedTypeError()) : ok({ contentType, byteSize: bytes.length, data: bytes });
};

/** The lowercase hex sha256 of the bytes: the identity of an image in the audit log and the ETag. */
export const imageHash = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");
