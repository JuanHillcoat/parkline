import { isIP } from "node:net";

const MAX_LENGTH = 45; // longest textual IPv6 form, including an embedded IPv4 tail

/**
 * The client address for sign-in throttling. `x-forwarded-for` is client-controlled
 * unless a proxy overwrites it, so it counts only when the deployment says it sits
 * behind such a proxy (`TRUST_FORWARDED_HOST=true`). Only the first value is used and
 * only when it is a plausible IPv4 or IPv6 address; anything else yields null, which
 * limits sign-in by email alone.
 */
const MAPPED = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/;

/** One spelling per address: lower case, compressed IPv6, and IPv4-mapped IPv6 as plain IPv4. */
const canonical = (address: string): string => {
  if (isIP(address) === 4) return address;
  const v6 = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = MAPPED.exec(v6);
  if (mapped === null) return v6;
  const [high, low] = [parseInt(mapped[1] ?? "0", 16), parseInt(mapped[2] ?? "0", 16)];
  return `${String(high >> 8)}.${String(high & 255)}.${String(low >> 8)}.${String(low & 255)}`;
};

export const clientAddress = (forwardedFor: string | null, trustProxy: boolean): string | null => {
  if (!trustProxy || forwardedFor === null) return null;
  const first = (forwardedFor.split(",")[0] ?? "").trim();
  if (first === "" || first.length > MAX_LENGTH) return null;
  return isIP(first) === 0 ? null : canonical(first);
};
