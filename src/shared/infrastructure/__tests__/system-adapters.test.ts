import { describe, expect, it } from "vitest";
import { FixedClock } from "../fixed-clock";
import { SequentialIdGenerator } from "../sequential-id-generator";
import { SystemClock } from "../system-clock";
import { UuidIdGenerator } from "../uuid-id-generator";

describe("SystemClock", () => {
  it("returns the current time", () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});

describe("UuidIdGenerator", () => {
  it("returns distinct UUIDs", () => {
    const ids = new UuidIdGenerator();
    const [a, b] = [ids.next(), ids.next()];
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("FixedClock", () => {
  it("returns the set time, as a copy", () => {
    const clock = new FixedClock(new Date("2026-01-01T00:00:00Z"));
    clock.now().setFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:00.000Z");
    clock.set(new Date("2026-02-01T00:00:00Z"));
    expect(clock.now().toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
});

describe("SequentialIdGenerator", () => {
  it("returns predictable ids", () => {
    const ids = new SequentialIdGenerator("id");
    expect([ids.next(), ids.next()]).toEqual(["id-1", "id-2"]);
  });
});
