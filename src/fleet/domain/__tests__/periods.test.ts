import { describe, expect, it } from "vitest";
import { overlapsAny, periodsOverlap, type Period } from "../periods";

const p = (validFrom: string, validTo: string | null): Period => ({ validFrom, validTo });

describe("periodsOverlap", () => {
  it("detects a partial overlap on either side", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-01-31"), p("2026-01-15", "2026-02-15"))).toBe(true);
    expect(periodsOverlap(p("2026-01-15", "2026-02-15"), p("2026-01-01", "2026-01-31"))).toBe(true);
  });

  it("detects a contained and a containing period", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-12-31"), p("2026-03-01", "2026-03-31"))).toBe(true);
    expect(periodsOverlap(p("2026-03-01", "2026-03-31"), p("2026-01-01", "2026-12-31"))).toBe(true);
  });

  it("treats both ends as inclusive: sharing one day overlaps", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-01-31"), p("2026-01-31", "2026-02-10"))).toBe(true);
    expect(periodsOverlap(p("2026-01-05", "2026-01-05"), p("2026-01-05", "2026-01-05"))).toBe(true);
  });

  it("does not overlap contiguous periods (the next day)", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-01-31"), p("2026-02-01", null))).toBe(false);
    expect(periodsOverlap(p("2026-02-01", null), p("2026-01-01", "2026-01-31"))).toBe(false);
  });

  it("treats a null end as open: it overlaps anything that ends on or after its start", () => {
    expect(periodsOverlap(p("2026-01-01", null), p("2030-01-01", "2030-01-02"))).toBe(true);
    expect(periodsOverlap(p("2026-01-01", null), p("2025-01-01", "2025-12-31"))).toBe(false);
    expect(periodsOverlap(p("2026-01-01", null), p("2025-01-01", "2026-01-01"))).toBe(true);
    expect(periodsOverlap(p("2026-01-01", null), p("2027-01-01", null))).toBe(true);
  });

  it("does not overlap separated periods", () => {
    expect(periodsOverlap(p("2026-01-01", "2026-01-10"), p("2026-02-01", "2026-02-10"))).toBe(false);
  });
});

describe("overlapsAny", () => {
  it("is true when any period overlaps and false for none or an empty list", () => {
    const others = [p("2026-01-01", "2026-01-31"), p("2026-03-01", null)];
    expect(overlapsAny(p("2026-02-01", "2026-02-28"), others)).toBe(false);
    expect(overlapsAny(p("2026-02-01", "2026-03-01"), others)).toBe(true);
    expect(overlapsAny(p("2026-02-01", null), others)).toBe(true);
    expect(overlapsAny(p("2026-02-01", null), [])).toBe(false);
  });
});
