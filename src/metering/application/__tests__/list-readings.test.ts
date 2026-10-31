import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("ListEquipmentReadings", () => {
  it("is empty before the first reading and says the hours cannot be computed", async () => {
    const h = createHarness();
    const result = await h.listReadings.execute({ actor: h.viewer, equipmentId: "hours" });
    expect(result.ok && result.value).toEqual({
      meterKind: "hours", archived: false, meter: null, history: [], lastReading: null,
      hoursLast30Days: { hours: 0, incomplete: true },
      baseReading: null, hoursThisMonth: 0, monthlyTotals: new Array<number>(12).fill(0),
    });
  });

  it("returns the history newest first with kind and the superseded marker, the open meter and the last effective reading", async () => {
    const h = createHarness();
    const a = await h.record("2026-01-10", 100);
    const b = await h.record("2026-02-10", 200);
    const fix = h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: b.id, value: 210, reason: "Typo" }));
    const result = h.orThrow(await h.listReadings.execute({ actor: h.manager, equipmentId: "hours" }));
    expect(result.history.map((r) => [r.id, r.kind, r.value, r.superseded])).toEqual([
      [fix.id, "correction", 210, false],
      [b.id, "reading", 200, true],
      [a.id, "reading", 100, false],
    ]);
    expect(result.lastReading).toEqual({ id: b.id, meterId: result.meter?.id, readOn: "2026-02-10", value: 210 });
    expect(result.meter).toMatchObject({ kind: "hours", closedOn: null });
  });

  it("orders by day then by creation, newest first, across a replacement", async () => {
    const h = createHarness();
    await h.record("2026-02-10", 100);
    await h.record("2026-02-20", 150);
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-20", finalValue: 160, initialValue: 0, reason: "Falla" }));
    const result = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours" }));
    expect(result.history.map((r) => r.kind)).toEqual(["replacement_open", "replacement_close", "reading", "reading"]);
    expect(result.lastReading).toMatchObject({ readOn: "2026-02-20", value: 0 });
  });

  it("computes the hours of the last 30 days across a replacement, and flags an incomplete period", async () => {
    const h = createHarness();
    await h.record("2026-01-25", 1000);
    await h.record("2026-02-10", 1100);
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-15", finalValue: 1150, initialValue: 0, reason: "Falla" }));
    await h.record("2026-02-28", 40);
    const complete = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours" }));
    expect(complete.hoursLast30Days).toEqual({ hours: 190, incomplete: false });
    const lone = createHarness();
    await lone.record("2026-02-28", 40);
    const sparse = lone.orThrow(await lone.listReadings.execute({ actor: lone.admin, equipmentId: "hours" }));
    expect(sparse.hoursLast30Days).toEqual({ hours: 0, incomplete: true });
  });

  it("answers a no-meter type with an empty history and never writes or audits", async () => {
    const h = createHarness();
    const result = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "none" }));
    expect(result).toMatchObject({ meterKind: "none", history: [], meter: null });
    expect(h.audit.entries).toHaveLength(0);
    expect(h.equipment.calls).toEqual(["find none"]);
  });

  it("returns the base reading, the month total and the twelve monthly totals of the current year", async () => {
    const h = createHarness();
    await h.record("2025-12-20", 900);
    await h.record("2026-01-10", 1000);
    const wrong = await h.record("2026-02-10", 1100);
    await h.record("2026-03-01", 1130);
    h.orThrow(await h.correctReading.execute({ actor: h.admin, equipmentId: "hours", readingId: wrong.id, value: 1120, reason: "Typo" }));
    const result = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours" }));
    expect(result.baseReading).toBe(900);
    expect(result.hoursThisMonth).toBe(10);
    expect(result.monthlyTotals).toEqual([100, 120, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("returns the monthly totals of the year asked for, and of the current year without one", async () => {
    const h = createHarness();
    await h.record("2025-11-10", 800);
    await h.record("2025-12-20", 900);
    await h.record("2026-01-10", 1000);
    const lastYear = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours", year: 2025 }));
    expect(lastYear.monthlyTotals).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100]);
    const thisYear = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours" }));
    expect(thisYear.monthlyTotals[0]).toBe(100);
    expect(lastYear.baseReading).toBe(800);
    expect(lastYear.hoursThisMonth).toBe(thisYear.hoursThisMonth);
  });

  it("uses the first reading of the open meter as the base after a replacement", async () => {
    const h = createHarness();
    await h.record("2026-01-10", 1000);
    h.orThrow(await h.replaceMeter.execute({ actor: h.admin, equipmentId: "hours", day: "2026-02-15", finalValue: 1150, initialValue: 5, reason: "Falla" }));
    await h.record("2026-02-20", 20);
    const result = h.orThrow(await h.listReadings.execute({ actor: h.admin, equipmentId: "hours" }));
    expect(result.baseReading).toBe(5);
    expect(result.monthlyTotals.slice(0, 3)).toEqual([0, 165, 0]);
  });
});
