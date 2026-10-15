const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

/**
 * The host a request was addressed to. `x-forwarded-host` is client-controlled
 * unless a proxy overwrites it, so it counts only when the deployment says it
 * sits behind such a proxy (`TRUST_FORWARDED_HOST=true`).
 */
export const requestHost = (forwarded: string | null, host: string | null, trustProxy: boolean): string | null =>
  trustProxy && forwarded !== null ? forwarded : host;

/**
 * CSRF check for state-changing requests (decision D7): the `Origin` header
 * must be present and must name the host the request was addressed to.
 */
export const isSameOrigin = (origin: string | null, host: string | null): boolean => {
  if (origin === null || host === null || host === "") return false;
  return hostOf(origin) === host;
};
