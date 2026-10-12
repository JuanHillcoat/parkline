import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_POLICY, sessionRejection, type Session } from "../session";

const HOUR = 3600 * 1000;
const start = new Date("2026-01-01T00:00:00Z");

const session: Session = {
  id: "s-1",
  tenantId: "tenant-a",
  userId: "user-1",
  tokenHash: "hash",
  createdAt: start,
  lastSeenAt: start,
  expiresAt: new Date(start.getTime() + 7 * 24 * HOUR),
  revokedAt: null,
};

const at = (hours: number): Date => new Date(start.getTime() + hours * HOUR);

describe("sessionRejection", () => {
  it("defaults to 12 hours idle and 7 days absolute", () => {
    expect(DEFAULT_SESSION_POLICY).toEqual({ idleSeconds: 12 * 3600, absoluteSeconds: 7 * 24 * 3600 });
  });

  it("accepts a live session", () => {
    expect(sessionRejection(session, at(1), DEFAULT_SESSION_POLICY)).toBeNull();
  });

  it("rejects a revoked session first", () => {
    const revoked = { ...session, revokedAt: at(1) };
    expect(sessionRejection(revoked, at(2), DEFAULT_SESSION_POLICY)).toBe("revoked");
  });

  it("rejects past the absolute expiry", () => {
    const touched = { ...session, lastSeenAt: at(7 * 24 - 1) };
    expect(sessionRejection(touched, at(7 * 24), DEFAULT_SESSION_POLICY)).toBe("expired");
  });

  it("rejects after the idle window", () => {
    expect(sessionRejection(session, at(12), DEFAULT_SESSION_POLICY)).toBe("idle");
    expect(sessionRejection(session, at(11.9), DEFAULT_SESSION_POLICY)).toBeNull();
  });
});
