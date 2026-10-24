import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "../../../src/shared/domain/image";
import {
  MAX_SIDE,
  MAX_UPLOAD_BYTES,
  MIN_QUALITY,
  START_QUALITY,
  encodeWithinLimit,
  lowerQuality,
  needsDownscale,
  targetSize,
  webpName,
} from "../image-downscale";

describe("the client limit", () => {
  it("matches the server limit of the shared kernel", () => {
    expect(MAX_UPLOAD_BYTES).toBe(MAX_IMAGE_BYTES);
  });
});

describe("needsDownscale", () => {
  const small = { width: 800, height: 600 };

  it("leaves a small image alone, at the limits included", () => {
    expect(needsDownscale(10_000, small)).toBe(false);
    expect(needsDownscale(MAX_UPLOAD_BYTES, { width: MAX_SIDE, height: 100 })).toBe(false);
  });

  it("re-encodes an image over 500 KB", () => {
    expect(needsDownscale(MAX_UPLOAD_BYTES + 1, small)).toBe(true);
  });

  it("re-encodes an image whose longest side is over 1280 px, in either orientation", () => {
    expect(needsDownscale(10_000, { width: MAX_SIDE + 1, height: 100 })).toBe(true);
    expect(needsDownscale(10_000, { width: 100, height: MAX_SIDE + 1 })).toBe(true);
  });
});

describe("targetSize", () => {
  it("keeps the size of an image that already fits", () => {
    expect(targetSize({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 });
  });

  it("scales a wide image so its width is 1280 and keeps the aspect ratio", () => {
    expect(targetSize({ width: 4000, height: 3000 })).toEqual({ width: 1280, height: 960 });
  });

  it("scales a tall image so its height is 1280", () => {
    expect(targetSize({ width: 3000, height: 4000 })).toEqual({ width: 960, height: 1280 });
  });

  it("never returns a side of zero", () => {
    expect(targetSize({ width: 100_000, height: 10 })).toEqual({ width: 1280, height: 1 });
  });
});

describe("lowerQuality", () => {
  it("steps down by a tenth without floating point noise", () => {
    expect(lowerQuality(START_QUALITY)).toBe(0.72);
    expect(lowerQuality(0.72)).toBe(0.62);
  });

  it("stops below the floor", () => {
    let quality: number | null = START_QUALITY;
    let last = START_QUALITY;
    while (quality !== null) {
      last = quality;
      quality = lowerQuality(quality);
    }
    expect(last).toBeGreaterThanOrEqual(MIN_QUALITY);
    expect(lowerQuality(last)).toBeNull();
  });
});

const webp = (size: number) => ({ size, type: "image/webp" });

describe("encodeWithinLimit", () => {
  it("returns the first encoding that fits, at the starting quality", async () => {
    const qualities: number[] = [];
    const result = await encodeWithinLimit((quality) => {
      qualities.push(quality);
      return Promise.resolve(webp(MAX_UPLOAD_BYTES));
    });
    expect(result?.size).toBe(MAX_UPLOAD_BYTES);
    expect(qualities).toEqual([START_QUALITY]);
  });

  it("lowers the quality in steps while the result is over the limit", async () => {
    const qualities: number[] = [];
    const result = await encodeWithinLimit((quality) => {
      qualities.push(quality);
      return Promise.resolve(webp(quality > 0.6 ? MAX_UPLOAD_BYTES + 1 : 1000));
    });
    expect(qualities).toEqual([0.82, 0.72, 0.62, 0.52]);
    expect(result?.size).toBe(1000);
  });

  it("returns the last attempt when no quality fits, so the server can answer too large", async () => {
    const result = await encodeWithinLimit(() => Promise.resolve(webp(MAX_UPLOAD_BYTES * 2)));
    expect(result?.size).toBe(MAX_UPLOAD_BYTES * 2);
  });

  it("gives up when the browser cannot encode WebP (another type or nothing)", async () => {
    expect(await encodeWithinLimit(() => Promise.resolve({ size: 10, type: "image/png" }))).toBeNull();
    expect(await encodeWithinLimit(() => Promise.resolve(null))).toBeNull();
  });
});

describe("webpName", () => {
  it("swaps the extension and handles names without one", () => {
    expect(webpName("photo.JPG")).toBe("photo.webp");
    expect(webpName("a.b.png")).toBe("a.b.webp");
    expect(webpName("photo")).toBe("photo.webp");
    expect(webpName("")).toBe("image.webp");
  });
});
