const hostOf = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

/**
 * CSRF check for state-changing requests (decision D7): the `Origin` header
 * must be present and must name the host the request was addressed to.
 */
export const isSameOrigin = (origin: string | null, host: string | null): boolean => {
  if (origin === null || host === null || host === "") return false;
  return hostOf(origin) === host;
};
