import { describe, expect, it } from "vitest";
import { etagOf, imageHeaders, isEquipmentId, matchesEtag, notModifiedHeaders } from "../image-response";

const image = { contentType: "image/png", byteSize: 1234, sha256: "ab".repeat(32) };
const ID = "0b8f7a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";

describe("isEquipmentId", () => {
  it("accepts a uuid in either case", () => {
    expect(isEquipmentId(ID)).toBe(true);
    expect(isEquipmentId(ID.toUpperCase())).toBe(true);
  });

  it("rejects anything else, including injection attempts", () => {
    for (const id of ["", "abc", ID.replaceAll("-", ""), `${ID}/../x`, "' or 1=1 --"]) {
      expect(isEquipmentId(id)).toBe(false);
    }
  });
});

describe("matchesEtag", () => {
  const etag = etagOf(image.sha256);

  it("quotes the hash", () => {
    expect(etag).toBe(`"${image.sha256}"`);
  });

  it("matches the exact tag, a weak tag, a list that contains it and the wildcard", () => {
    expect(matchesEtag(etag, etag)).toBe(true);
    expect(matchesEtag(`W/${etag}`, etag)).toBe(true);
    expect(matchesEtag(`"other", ${etag}`, etag)).toBe(true);
    expect(matchesEtag("*", etag)).toBe(true);
  });

  it("does not match a missing header or another tag", () => {
    expect(matchesEtag(null, etag)).toBe(false);
    expect(matchesEtag('"other"', etag)).toBe(false);
    expect(matchesEtag(image.sha256, etag)).toBe(false);
  });
});

describe("imageHeaders", () => {
  it("carries the stored type, the size, the validator and every safety header", () => {
    expect(imageHeaders(image)).toEqual({
      "Content-Type": "image/png",
      "Content-Length": "1234",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-cache",
      ETag: `"${image.sha256}"`,
    });
  });
});

describe("notModifiedHeaders", () => {
  it("repeats the validator and the cache policy and sends no content headers", () => {
    const headers = notModifiedHeaders(image);
    expect(headers.ETag).toBe(`"${image.sha256}"`);
    expect(headers["Cache-Control"]).toBe("private, no-cache");
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers["Content-Length"]).toBeUndefined();
  });
});
