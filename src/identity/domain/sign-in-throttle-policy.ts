export type SignInThrottlePolicy = {
  readonly windowSeconds: number;
  readonly maxFailuresPerEmail: number;
  readonly maxFailuresPerAddress: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
};

/** Decision D2: 15 minute window, 5 failures per email, 20 per address, 60 s doubling up to 15 min. */
export const DEFAULT_SIGN_IN_THROTTLE_POLICY: SignInThrottlePolicy = {
  windowSeconds: 900,
  maxFailuresPerEmail: 5,
  maxFailuresPerAddress: 20,
  baseDelaySeconds: 60,
  maxDelaySeconds: 900,
};

/** Failures at or before this instant no longer count. */
export const throttleWindowStart = (now: Date, policy: SignInThrottlePolicy): Date =>
  new Date(now.getTime() - policy.windowSeconds * 1000);

/**
 * Until when one subject (an email or an address) is blocked, or null when it is free at `now`.
 * Only failures inside the window count. At `limit` failures the block lasts the base delay after
 * the latest failure and doubles with each extra failure, up to the cap.
 */
export const signInBlockedUntil = (
  failures: readonly Date[],
  limit: number,
  now: Date,
  policy: SignInThrottlePolicy,
): Date | null => {
  const since = throttleWindowStart(now, policy).getTime();
  const counted = failures.map((at) => at.getTime()).filter((at) => at > since);
  if (counted.length < limit) return null;
  const delay = Math.min(policy.baseDelaySeconds * 2 ** (counted.length - limit), policy.maxDelaySeconds);
  const until = Math.max(...counted) + delay * 1000;
  return now.getTime() < until ? new Date(until) : null;
};

/** Whole seconds a blocked client should wait; never below one. */
export const retryAfterSeconds = (until: Date, now: Date): number =>
  Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
