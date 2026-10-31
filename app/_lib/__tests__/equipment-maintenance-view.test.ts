import { describe, expect, it } from "vitest";
import type { EquipmentListItem } from "../../../src/fleet/application/equipment-visibility";
import type { EquipmentReadings } from "../../../src/metering/application/use-cases/list-equipment-readings";
import { copy } from "../copy";
import { buildMaintenanceView, formatCycle, maintenanceInput, type MaintenanceInput } from "../equipment-maintenance-view";

const t = copy.fleet.detail.maintenance;

const input = (overrides: Partial<MaintenanceInput> = {}): MaintenanceInput => ({
  meterKind: "hours", interval: 250, baseReading: 100, lastReading: 230, hoursThisMonth: 12.5, ...overrides,
});

describe("formatCycle", () => {
  it("drops the decimal of a whole number, keeps one otherwise, groups thousands with a dot and adds the unit", () => {
    expect(formatCycle(230, "hours")).toBe("230 hs");
    expect(formatCycle(12.5, "hours")).toBe("12,5 hs");
    expect(formatCycle(1234.5, "km")).toBe("1.234,5 km");
    expect(formatCycle(-50, "hours")).toBe("-50 hs");
    expect(formatCycle(0, "hours")).toBe("0 hs");
  });
});

describe("buildMaintenanceView", () => {
  it("shows the hours accumulated in the cycle inside the ring and the rows beside it", () => {
    const view = buildMaintenanceView(input());
    expect(view).toMatchObject({ kind: "figures", consumed: "130 hs", percent: 52, state: "ok", stateLabel: t.states.ok, tone: "ok" });
    if (view.kind !== "figures") throw new Error("expected figures");
    expect(view.rows).toEqual([
      { label: t.current.hours, value: "230 hs", tone: null },
      { label: t.month.hours, value: "12,5 hs", tone: null },
      { label: t.remaining.hours, value: "120 hs", tone: null },
      { label: t.next, value: "350 hs", tone: null },
    ]);
  });

  it("marks the remaining row and the state when the preventive is due soon", () => {
    const view = buildMaintenanceView(input({ lastReading: 300 }));
    expect(view).toMatchObject({ kind: "figures", consumed: "200 hs", state: "due_soon", stateLabel: t.states.due_soon, tone: "warn", percent: 80 });
    if (view.kind !== "figures") throw new Error("expected figures");
    expect(view.rows[2]).toEqual({ label: t.remaining.hours, value: "50 hs", tone: "warn" });
  });

  it("is overdue at or past the next reading, with the ring capped at 100%", () => {
    const view = buildMaintenanceView(input({ lastReading: 400 }));
    expect(view).toMatchObject({ kind: "figures", state: "overdue", stateLabel: t.states.overdue, tone: "danger", percent: 100 });
    if (view.kind !== "figures") throw new Error("expected figures");
    expect(view.rows[2]).toEqual({ label: t.remaining.hours, value: "-50 hs", tone: "danger" });
  });

  it("uses kilometers for a km meter", () => {
    const view = buildMaintenanceView(input({ meterKind: "km", interval: 1000, baseReading: 0, lastReading: 100, hoursThisMonth: 40 }));
    if (view.kind !== "figures") throw new Error("expected figures");
    expect(view.consumed).toBe("100 km");
    expect(view.rows.map((row) => row.label)).toEqual([t.current.km, t.month.km, t.remaining.km, t.next]);
  });

  it("says why there are no figures, in order: no meter, no readings, no interval", () => {
    expect(buildMaintenanceView(input({ meterKind: "none", lastReading: null }))).toEqual({ kind: "missing", reason: t.noMeter });
    expect(buildMaintenanceView(input({ lastReading: null, baseReading: null }))).toEqual({ kind: "missing", reason: t.noReadings });
    expect(buildMaintenanceView(input({ interval: null }))).toEqual({ kind: "missing", reason: t.noInterval });
  });
});

describe("maintenanceInput", () => {
  const item = { assetType: { meterKind: "hours", preventiveIntervalHours: 250 } } as EquipmentListItem;

  it("composes the asset type interval with the base, the last reading and the month hours", () => {
    const readings = { meterKind: "hours", baseReading: 100, lastReading: { value: 230 }, hoursThisMonth: 12.5 } as EquipmentReadings;
    expect(maintenanceInput(item, readings)).toEqual({ meterKind: "hours", interval: 250, baseReading: 100, lastReading: 230, hoursThisMonth: 12.5 });
  });

  it("takes the hours of the month the page is showing when given", () => {
    const readings = { meterKind: "hours", baseReading: 100, lastReading: { value: 230 }, hoursThisMonth: 12.5 } as EquipmentReadings;
    expect(maintenanceInput(item, readings, 40).hoursThisMonth).toBe(40);
  });

  it("falls back to the asset type's meter without readings the actor can read", () => {
    expect(maintenanceInput(item, null)).toEqual({ meterKind: "hours", interval: 250, baseReading: null, lastReading: null, hoursThisMonth: 0 });
  });
});
