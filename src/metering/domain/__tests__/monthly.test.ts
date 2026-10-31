import { describe, expect, it } from "vitest";
import type { MeterReading, ReadingKind } from "../entities";
import { monthTotal, monthlyTotals } from "../monthly";
import { effectiveReadings } from "../readings";

let counter = 0;
const row = (readOn: string, tenths: number, kind: ReadingKind = "reading", meterId = "m1"): MeterReading => {
  counter += 1;
  return {
    id: `r${String(counter)}`, tenantId: "t", meterId, readOn, valueTenths: tenths, kind,
    correctsId: null, reason: null, createdBy: "u", createdAt: new Date("2026-01-01T00:00:00Z"),
  };
};
const timeline = (...rows: MeterReading[]) => effectiveReadings(rows);

describe("monthlyTotals", () => {
  it("is twelve zeros without readings", () => {
    expect(monthlyTotals([], 2026)).toEqual(new Array<number>(12).fill(0));
  });

  it("gives each month the growth of its own days, and the months add up to the year", () => {
    const segment = timeline(row("2026-01-10", 1000), row("2026-01-31", 1100), row("2026-02-15", 1250), row("2026-03-31", 1400));
    const totals = monthlyTotals([segment], 2026);
    expect(totals.slice(0, 4)).toEqual([10, 15, 15, 0]);
    expect(totals.reduce((a, b) => a + b, 0)).toBe(40);
  });

  it("counts a reading taken on the first of a month in that month", () => {
    const segment = timeline(row("2026-01-31", 1000), row("2026-02-01", 1050), row("2026-02-28", 1200));
    expect(monthlyTotals([segment], 2026).slice(1, 2)).toEqual([20]);
  });

  it("ignores other years and leaves later months at zero", () => {
    const segment = timeline(row("2025-12-20", 500), row("2026-01-20", 800));
    const totals = monthlyTotals([segment], 2026);
    expect(totals[0]).toBe(30);
    expect(totals.slice(1)).toEqual(new Array<number>(11).fill(0));
    expect(monthlyTotals([segment], 2025)[11]).toBe(0);
  });

  it("sums the segments of a meter replacement", () => {
    const old = timeline(row("2026-02-01", 1000), row("2026-02-10", 1100, "replacement_close"));
    const fresh = timeline(row("2026-02-10", 0, "replacement_open", "m2"), row("2026-02-20", 50, "reading", "m2"));
    expect(monthlyTotals([old, fresh], 2026)[1]).toBe(15);
  });
});

describe("monthTotal", () => {
  const segment = timeline(row("2026-09-30", 1000), row("2026-10-12", 1080), row("2026-11-02", 1200));

  it("totals the calendar month of the given day", () => {
    expect(monthTotal([segment], "2026-10-29")).toBe(8);
    expect(monthTotal([segment], "2026-10-01")).toBe(8);
  });

  it("is zero for a month with no readings", () => {
    expect(monthTotal([], "2026-10-29")).toBe(0);
  });
});
