/** What a failed sign-in is counted against. `hash` is a SHA-256 hex digest, never the clear value. */
export type ThrottleSubject = { readonly kind: "email" | "address"; readonly hash: string };

export type ThrottleFailure = ThrottleSubject & { readonly at: Date };

/** Failed sign-in attempts, scoped by tenant. All methods work inside the caller's unit of work. */
export interface SignInThrottle {
  /** Failures of any of `subjects` strictly after `since`. */
  failuresSince(tenantId: string, subjects: readonly ThrottleSubject[], since: Date): Promise<readonly ThrottleFailure[]>;
  /** One failure row per subject, all at `at`. */
  recordFailure(tenantId: string, subjects: readonly ThrottleSubject[], at: Date): Promise<void>;
  /** Forgets every failure of one subject. */
  clear(tenantId: string, subject: ThrottleSubject): Promise<void>;
  /** Deletes failures at or before `before`, for every subject of the tenant. */
  prune(tenantId: string, before: Date): Promise<void>;
}
