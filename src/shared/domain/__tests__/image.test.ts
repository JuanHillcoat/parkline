import { describe, expect, it } from "vitest";
import { imageHash, MAX_IMAGE_BYTES, parseImage } from "../image";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const text = (value: string): number[] => [...new TextEncoder().encode(value)];
const WEBP = [...text("RIFF"), 1, 2, 3, 4, ...text("WEBP")];

/** The magic bytes followed by zeros up to `size` bytes. */
const padded = (magic: readonly number[], size: number): Uint8Array => {
  const bytes = new Uint8Array(size);
  bytes.set(magic);
  return bytes;
};

const code = (result: ReturnType<typeof parseImage>): string => (result.ok ? "ok" : result.error.code);

describe("parseImage", () => {
  it("accepts a JPEG, a PNG and a WebP by their magic bytes", () => {
    const cases = [
      [JPEG, "image/jpeg"],
      [PNG, "image/png"],
      [WEBP, "image/webp"],
    ] as const;
    for (const [magic, contentType] of cases) {
      const result = parseImage(padded(magic, 64));
      expect(result.ok && result.value).toMatchObject({ contentType, byteSize: 64 });
    }
  });

  it("returns the bytes it was given", () => {
    const bytes = padded(PNG, 16);
    const result = parseImage(bytes);
    expect(result.ok && [...result.value.data]).toEqual([...bytes]);
  });

  it("rejects an empty file", () => {
    expect(code(parseImage(new Uint8Array(0)))).toBe("image_empty");
  });

  it("accepts exactly 500 KB and rejects one byte more", () => {
    expect(MAX_IMAGE_BYTES).toBe(512000);
    expect(code(parseImage(padded(JPEG, MAX_IMAGE_BYTES)))).toBe("ok");
    expect(code(parseImage(padded(JPEG, MAX_IMAGE_BYTES + 1)))).toBe("image_too_large");
  });

  it("checks the size before the type", () => {
    expect(code(parseImage(padded([0, 0, 0], MAX_IMAGE_BYTES + 1)))).toBe("image_too_large");
  });

  it("rejects a truncated header of each type", () => {
    for (const bytes of [JPEG.slice(0, 2), PNG.slice(0, 7), WEBP.slice(0, 11), [0xff]]) {
      expect(code(parseImage(Uint8Array.from(bytes)))).toBe("image_unsupported_type");
    }
  });

  it("rejects a RIFF container that is not WebP", () => {
    const wave = [...text("RIFF"), 1, 2, 3, 4, ...text("WAVE")];
    expect(code(parseImage(Uint8Array.from(wave)))).toBe("image_unsupported_type");
  });

  it("rejects SVG, GIF, HTML and plain text", () => {
    const samples = [
      text('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      text('<?xml version="1.0"?><svg></svg>'),
      text("GIF89a......"),
      text("<html><script>alert(1)</script></html>"),
      text("hello"),
    ];
    for (const sample of samples) expect(code(parseImage(Uint8Array.from(sample)))).toBe("image_unsupported_type");
  });

  it("types a polyglot only by its leading magic bytes", () => {
    const polyglot = Uint8Array.from([...JPEG, ...text("<script>alert(1)</script><svg></svg>")]);
    const result = parseImage(polyglot);
    expect(result.ok && result.value.contentType).toBe("image/jpeg");
    const svgFirst = Uint8Array.from([...text("<svg>"), ...JPEG]);
    expect(code(parseImage(svgFirst))).toBe("image_unsupported_type");
  });
});

describe("imageHash", () => {
  it("is the lowercase sha256 hex of the bytes", () => {
    expect(imageHash(Uint8Array.from(text("abc")))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
