/** Pure helpers of the equipment image endpoint: the id check, the validators and the response headers. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** A malformed id is a 404 before it reaches the database (a uuid column would reject it with an error). */
export const isEquipmentId = (id: string): boolean => UUID.test(id);

/** The ETag is the sha256 of the bytes, quoted. */
export const etagOf = (sha256: string): string => `"${sha256}"`;

/** Whether an `If-None-Match` header names this ETag: `*`, one tag or a list, weak validators included. */
export const matchesEtag = (header: string | null, etag: string): boolean => {
  if (header === null) return false;
  return header.split(",").some((part) => {
    const tag = part.trim().replace(/^W\//u, "");
    return tag === "*" || tag === etag;
  });
};

export type ServedImage = { readonly contentType: string; readonly byteSize: number; readonly sha256: string };

/** Never a page: the type is stored, sniffing is off and a sandboxed empty policy covers a direct visit. */
const SAFETY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cache-Control": "private, no-cache",
} as const;

/** The headers of a 200 answer. Nothing here comes from the request. */
export const imageHeaders = (image: ServedImage): Record<string, string> => ({
  ...SAFETY_HEADERS,
  "Content-Type": image.contentType,
  "Content-Length": String(image.byteSize),
  "Content-Disposition": "inline",
  ETag: etagOf(image.sha256),
});

/** The headers of a 304 answer: the validator and the cache policy, no body. */
export const notModifiedHeaders = (image: ServedImage): Record<string, string> => ({
  ...SAFETY_HEADERS,
  ETag: etagOf(image.sha256),
});
