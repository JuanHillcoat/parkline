import { isIP } from "node:net";

const MAX_LENGTH = 45; // longest textual IPv6 form, including an embedded IPv4 tail

/**
 * The client address for sign-in throttling. `x-forwarded-for` is client-controlled
 * unless a proxy overwrites it, so it counts only when the deployment says it sits
 * behind such a proxy (`TRUST_FORWARDED_HOST=true`). Only the first value is used and
 * only when it is a plausible IPv4 or IPv6 address; anything else yields null, which
 * limits sign-in by email alone.
 */
export const clientAddress = (forwardedFor: string | null, trustProxy: boolean): string | null => {
  if (!trustProxy || forwardedFor === null) return null;
  const first = (forwardedFor.split(",")[0] ?? "").trim();
  if (first === "" || first.length > MAX_LENGTH) return null;
  return isIP(first) === 0 ? null : first;
};
