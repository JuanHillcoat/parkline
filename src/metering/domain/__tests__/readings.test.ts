import { describe, expect, it } from "vitest";
import type { MeterReading, ReadingKind } from "../entities";
import { checkCorrection, checkNewReading, effectiveReadings, hoursBetween, rootOf } from "../readings";

let counter = 0;
const row = (readOn: string, tenths: number, kind: ReadingKind = "reading", extra: Partial<MeterReading> = {}): MeterReading => {
  counter += 1;
  return {
    id: `r${String(counter)}`, tenantId: "t", meterId: "m1", readOn, valueTenths: tenths, kind,
    correctsId: null, reason: null, createdBy: "u", createdAt: new Date("2026-01-01T00:00:00Z"), ...extra,
  };
};
const correction = (of: MeterReading, tenths: number): MeterReading =>
  row(of.readOn, tenths, "correction", { correctsId: of.id, reason: "typo" });

describe("effectiveReadings", () => {
  it("orders by day then insertion and uses the latest correction of each reading", () => {
    const a = row("2026-01-10", 100);
    const b = row("2026-01-05", 50);
    const c = row("2026-01-10", 120);
    const fixed = correction(b, 60);
    const fixedAgain = correction(b, 70);
    const effective = effectiveReadings([a, b, c, fixed, fixedAgain]);
    expect(effective.map((e) => [e.id, e.valueTenths])).toEqual([[b.id, 70], [a.id, 100], [c.id, 120]]);
  });

  it("resolves the root of a correction chain", () => {
    const a = row("2026-01-10", 100);
    const first = correction(a, 110);
    const second = row("2026-01-10", 120, "correction", { correctsId: first.id });
    expect(rootOf([a, first, second], second.id)).toBe(a.id);
    expect(effectiveReadings([a, first, second])[0]?.valueTenths).toBe(120);
  });
});

describe("checkNewReading", () => {
  const timeline = effectiveReadings([row("2026-01-10", 100), row("2026-01-20", 200)]);

  it("accepts an equal value, a value between neighbors and the first reading", () => {
    expect(checkNewReading(timeline, "2026-01-25", 200).ok).toBe(true);
    expect(checkNewReading(timeline, "2026-01-15", 150).ok).toBe(true);
    expect(checkNewReading([], "2026-01-01", 0).ok).toBe(true);
  });

  it("accepts a same-day reading that does not go down", () => {
    expect(checkNewReading(timeline, "2026-01-20", 200).ok).toBe(true);
    expect(checkNewReading(timeline, "2026-01-20", 250).ok).toBe(true);
    const lower = checkNewReading(timeline, "2026-01-20", 199);
    expect(!lower.ok && lower.error.code).toBe("reading_out_of_order");
  });

  it("refuses a lower value and says it must be a meter replacement", () => {
    const lower = checkNewReading(timeline, "2026-01-25", 150);
    expect(!lower.ok && lower.error.message).toMatch(/meter replacement/);
  });

  it("refuses a backdated reading that does not fit between its neighbors", () => {
    expect(checkNewReading(timeline, "2026-01-15", 99).ok).toBe(false);
    expect(checkNewReading(timeline, "2026-01-15", 201).ok).toBe(false);
    expect(checkNewReading(timeline, "2026-01-05", 101).ok).toBe(false);
    expect(checkNewReading(timeline, "2026-01-05", 100).ok).toBe(true);
  });
});

describe("checkCorrection", () => {
  const a = row("2026-01-10", 100);
  const b = row("2026-01-20", 200);
  const c = row("2026-01-30", 300);
  const timeline = effectiveReadings([a, b, c, correction(c, 310)]);

  it("keeps the corrected reading in its place and compares with its neighbors only", () => {
    expect(checkCorrection(timeline, b.id, 100).ok).toBe(true);
    expect(checkCorrection(timeline, b.id, 310).ok).toBe(true);
    expect(checkCorrection(timeline, b.id, 311).ok).toBe(false);
    expect(checkCorrection(timeline, b.id, 99).ok).toBe(false);
    expect(checkCorrection(timeline, c.id, 9999).ok).toBe(true);
    expect(checkCorrection(timeline, a.id, 0).ok).toBe(true);
  });
});

describe("hoursBetween", () => {
  const seg = (...rows: MeterReading[]) => effectiveReadings(rows);

  it("is the difference of the last readings on or before each day", () => {
    const s = seg(row("2026-01-01", 1000), row("2026-01-10", 1100), row("2026-01-20", 1250));
    expect(hoursBetween([s], "2026-01-05", "2026-01-25")).toEqual({ hours: 25, incomplete: false });
    expect(hoursBetween([s], "2026-01-10", "2026-01-20")).toEqual({ hours: 15, incomplete: false });
  });

  it("uses corrected values", () => {
    const base = row("2026-01-10", 1100);
    const s = seg(row("2026-01-01", 1000), base, correction(base, 1200));
    expect(hoursBetween([s], "2026-01-01", "2026-01-10")).toEqual({ hours: 20, incomplete: false });
  });

  it("sums the segments across a replacement in the middle", () => {
    const old = seg(row("2026-01-01", 1000), row("2026-01-10", 1100), row("2026-01-15", 1150, "replacement_close"));
    const fresh = seg(row("2026-01-15", 0, "replacement_open", { meterId: "m2" }), row("2026-01-25", 80, "reading", { meterId: "m2" }));
    expect(hoursBetween([old, fresh], "2026-01-10", "2026-01-25")).toEqual({ hours: 13, incomplete: false });
    expect(hoursBetween([old, fresh], "2026-01-16", "2026-01-30")).toEqual({ hours: 8, incomplete: false });
  });

  it("starts at the first reading when the segment opens inside the period", () => {
    const s = seg(row("2026-01-05", 50), row("2026-01-20", 80));
    expect(hoursBetween([s], "2026-01-01", "2026-01-31")).toEqual({ hours: 3, incomplete: false });
  });

  it("is incomplete with fewer than two usable readings and contributes nothing", () => {
    expect(hoursBetween([seg(row("2026-01-05", 50))], "2026-01-01", "2026-01-31")).toEqual({ hours: 0, incomplete: true });
    expect(hoursBetween([seg(row("2026-01-05", 50), row("2026-01-06", 60))], "2026-02-01", "2026-02-28")).toEqual({ hours: 0, incomplete: true });
    const twoMeters = [seg(row("2026-01-01", 0), row("2026-01-30", 100)), seg(row("2026-01-30", 0, "replacement_open", { meterId: "m2" }))];
    expect(hoursBetween(twoMeters, "2026-01-01", "2026-01-30")).toEqual({ hours: 10, incomplete: true });
  });

  it("is incomplete without any segment or when none overlaps", () => {
    expect(hoursBetween([], "2026-01-01", "2026-01-31")).toEqual({ hours: 0, incomplete: true });
    expect(hoursBetween([seg(row("2026-03-01", 5), row("2026-03-02", 6))], "2026-01-01", "2026-01-31")).toEqual({ hours: 0, incomplete: true });
  });

  it("ignores a meter closed before the period", () => {
    const old = seg(row("2026-01-01", 0), row("2026-01-10", 100, "replacement_close"));
    const fresh = seg(row("2026-01-10", 0, "replacement_open", { meterId: "m2" }), row("2026-02-10", 70, "reading", { meterId: "m2" }));
    expect(hoursBetween([old, fresh], "2026-01-10", "2026-02-10")).toEqual({ hours: 7, incomplete: false });
  });
});
