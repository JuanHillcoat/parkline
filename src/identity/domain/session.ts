export type Session = {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  /** SHA-256 of the opaque token; the token itself is never stored. */
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
};

export type SessionPolicy = {
  readonly idleSeconds: number;
  readonly absoluteSeconds: number;
};

/** Decision D3: 12 hours idle, 7 days absolute. */
export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  idleSeconds: 12 * 3600,
  absoluteSeconds: 7 * 24 * 3600,
};

export type SessionRejection = "revoked" | "expired" | "idle";

/** Why a session can no longer be used at `now`, or null when it is live. */
export const sessionRejection = (
  session: Session,
  now: Date,
  policy: SessionPolicy,
): SessionRejection | null => {
  if (session.revokedAt !== null) return "revoked";
  if (session.expiresAt.getTime() <= now.getTime()) return "expired";
  const idleMs = now.getTime() - session.lastSeenAt.getTime();
  return idleMs >= policy.idleSeconds * 1000 ? "idle" : null;
};
