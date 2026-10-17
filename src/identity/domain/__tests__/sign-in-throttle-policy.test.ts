import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIGN_IN_THROTTLE_POLICY as POLICY,
  retryAfterSeconds,
  signInBlockedUntil,
} from "../sign-in-throttle-policy";

const NOW = new Date("2026-01-01T09:00:00Z");
const ago = (seconds: number): Date => new Date(NOW.getTime() - seconds * 1000);
const after = (base: Date, seconds: number): Date => new Date(base.getTime() + seconds * 1000);
const LIMIT = 5;
const blockedAt = (failures: readonly Date[], now: Date = NOW) =>
  signInBlockedUntil(failures, LIMIT, now, POLICY);

describe("signInBlockedUntil", () => {
  it("has the agreed defaults", () => {
    expect(POLICY).toEqual({
      windowSeconds: 900,
      maxFailuresPerEmail: 5,
      maxFailuresPerAddress: 20,
      baseDelaySeconds: 60,
      maxDelaySeconds: 900,
    });
  });

  it("does not block below the limit", () => {
    expect(blockedAt([ago(10), ago(20), ago(30), ago(40)])).toBeNull();
  });

  it("blocks at the limit for the base delay after the latest failure", () => {
    const failures = [ago(100), ago(80), ago(60), ago(40), ago(20)];
    expect(blockedAt(failures)).toEqual(after(ago(20), 60));
  });

  it("doubles the delay with every failure past the limit", () => {
    const six = [ago(100), ago(90), ago(80), ago(70), ago(60), ago(10)];
    const seven = [ago(110), ...six];
    expect(blockedAt(six)).toEqual(after(ago(10), 120));
    expect(blockedAt(seven)).toEqual(after(ago(10), 240));
  });

  it("caps the delay", () => {
    const many = Array.from({ length: 30 }, (_, i) => ago(100 + i));
    expect(blockedAt(many)).toEqual(after(ago(100), 900));
  });

  it("ignores failures outside the window", () => {
    const stale = Array.from({ length: 5 }, (_, i) => ago(901 + i));
    expect(blockedAt(stale)).toBeNull();
    expect(blockedAt([...stale, ago(10)])).toBeNull();
  });

  it("counts a failure exactly at the window edge as outside", () => {
    const edge = [ago(900), ago(40), ago(30), ago(20), ago(10)];
    expect(blockedAt(edge)).toBeNull();
    const inside = [ago(899), ago(40), ago(30), ago(20), ago(10)];
    expect(blockedAt(inside)).not.toBeNull();
  });

  it("is blocked strictly before the deadline and free at it", () => {
    const failures = [ago(100), ago(80), ago(60), ago(40), ago(20)];
    const until = after(ago(20), 60);
    expect(blockedAt(failures, after(until, -1))).toEqual(until);
    expect(blockedAt(failures, until)).toBeNull();
  });

  it("does not depend on the order of the failures", () => {
    const failures = [ago(20), ago(100), ago(40), ago(80), ago(60)];
    expect(blockedAt(failures)).toEqual(after(ago(20), 60));
  });
});

describe("retryAfterSeconds", () => {
  it("rounds up to whole seconds and is at least one", () => {
    expect(retryAfterSeconds(new Date(NOW.getTime() + 1500), NOW)).toBe(2);
    expect(retryAfterSeconds(new Date(NOW.getTime() + 1), NOW)).toBe(1);
    expect(retryAfterSeconds(after(NOW, 60), NOW)).toBe(60);
  });
});
