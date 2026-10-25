import { describe, expect, it } from "vitest";
import type { EquipmentReadings, ReadingRow } from "../../../src/metering/application/use-cases/list-equipment-readings";
import { buildInfoRows, parseDetailTab } from "../equipment-detail-view";
import { buildReadingsView, editableValue, formatReading, lastReadingRow, readingActions, whoLabel, type WhoNames } from "../readings-view";

const who: WhoNames = { selfId: "u1", selfName: "Ana", names: new Map([["u2", "Luis"]]) };

const row = (overrides: Partial<ReadingRow>): ReadingRow => ({
  id: "r1", tenantId: "t", meterId: "m1", readOn: "2026-01-05", valueTenths: 12345, value: 1234.5, kind: "reading",
  correctsId: null, reason: null, createdBy: "u1", createdAt: new Date("2026-01-05T10:00:00Z"), superseded: false, ...overrides,
});

const readings = (overrides: Partial<EquipmentReadings> = {}): EquipmentReadings => ({
  meterKind: "hours", archived: false, meter: null, history: [], lastReading: null, hoursLast30Days: { hours: 0, incomplete: true }, ...overrides,
});

const meter = { id: "m1", tenantId: "t", equipmentId: "e", kind: "hours", openedOn: "2026-01-05", closedOn: null, initialValueTenths: 0 } as const;

describe("formatReading", () => {
  it("shows one decimal with a comma, thousands with a dot and the unit", () => {
    expect(formatReading(1234.5, "hours")).toBe("1.234,5 h");
    expect(formatReading(0, "km")).toBe("0,0 km");
    expect(formatReading(9_999_999.9, "hours")).toBe("9.999.999,9 h");
    expect(formatReading(12, "km")).toBe("12,0 km");
  });

  it("gives the correction dialog a plain editable number", () => {
    expect(editableValue(1234.5)).toBe("1234.5");
    expect(editableValue(7)).toBe("7.0");
  });
});

describe("readingActions", () => {
  const base = { canWrite: true, canCorrect: true, archived: false, meterKind: "hours" } as const;

  it("gives writers every button once the meter exists", () => {
    expect(readingActions(base, true)).toEqual({ load: true, correct: true, replace: true });
  });

  it("offers no replacement before the first reading", () => {
    expect(readingActions(base, false)).toEqual({ load: true, correct: true, replace: false });
  });

  it("gives readers without the permissions no button", () => {
    expect(readingActions({ ...base, canWrite: false, canCorrect: false }, true)).toEqual({ load: false, correct: false, replace: false });
  });

  it("separates loading from correcting", () => {
    expect(readingActions({ ...base, canCorrect: false }, true)).toEqual({ load: true, correct: false, replace: false });
  });

  it("gives an archived equipment and one without a meter no button", () => {
    const none = { load: false, correct: false, replace: false };
    expect(readingActions({ ...base, archived: true }, true)).toEqual(none);
    expect(readingActions({ ...base, meterKind: "none" }, false)).toEqual(none);
  });
});

describe("whoLabel", () => {
  it("shows You for the viewer's own rows, a listed name for others and a dash otherwise", () => {
    expect(whoLabel("u1", who)).toBe("Tú");
    expect(whoLabel("u2", who)).toBe("Luis");
    expect(whoLabel("u3", who)).toBe("—");
  });
});

describe("buildReadingsView", () => {
  it("answers only the notice for a type without a meter", () => {
    expect(buildReadingsView(readings({ meterKind: "none" }), who)).toEqual({ kind: "none" });
  });

  it("maps the meter, the hours with their incomplete hint and the rows in order", () => {
    const history = [row({ id: "r2", kind: "correction", value: 10, readOn: "2026-02-01", reason: "Typo", createdBy: "u2" }), row({ superseded: true })];
    const view = buildReadingsView(readings({ meter, history, hoursLast30Days: { hours: 40.5, incomplete: false } }), who);
    expect(view).toMatchObject({
      kind: "meter", unit: "hours", meter: { opened: "05/01/2026", label: "Horas" }, hours: { text: "40,5 h", incomplete: false },
    });
    if (view.kind !== "meter") throw new Error("expected a meter view");
    expect(view.rows.map((r) => [r.day, r.value, r.kindLabel, r.who, r.reason, r.superseded])).toEqual([
      ["01/02/2026", "10,0 h", "Corrección", "Luis", "Typo", false],
      ["05/01/2026", "1.234,5 h", "Lectura", "Tú", "—", true],
    ]);
    expect(view.rows[0]?.form).toEqual({ value: "10.0", day: "01/02/2026" });
  });

  it("shows the unit of a km meter and no open meter before the first reading", () => {
    const view = buildReadingsView(readings({ meterKind: "km" }), who);
    expect(view).toMatchObject({ unit: "km", meter: null, hours: { text: "0,0 km", incomplete: true }, rows: [] });
  });

  it("labels the four kinds of row", () => {
    const kinds = ["reading", "correction", "replacement_close", "replacement_open"] as const;
    const view = buildReadingsView(readings({ meter, history: kinds.map((kind, i) => row({ id: String(i), kind })) }), who);
    if (view.kind !== "meter") throw new Error("expected a meter view");
    expect(view.rows.map((r) => r.kindLabel)).toEqual(["Lectura", "Corrección", "Cierre de medidor", "Apertura de medidor"]);
  });
});

describe("lastReadingRow", () => {
  it("shows the last effective reading with its day", () => {
    const last = { id: "r", meterId: "m", readOn: "2026-03-02", value: 88 };
    expect(lastReadingRow(readings({ lastReading: last }))).toEqual({ label: "Última lectura", value: "88,0 h (02/03/2026)" });
  });

  it("shows a dash without readings and nothing without a meter or without data", () => {
    expect(lastReadingRow(readings())?.value).toBe("—");
    expect(lastReadingRow(readings({ meterKind: "none" }))).toBeNull();
    expect(lastReadingRow(null)).toBeNull();
  });
});

describe("the detail page's tab and information rows", () => {
  it("accepts the readings tab", () => {
    expect(parseDetailTab("readings")).toBe("readings");
    expect(parseDetailTab("other")).toBe("info");
  });

  it("appends the extra rows last", () => {
    const rows = buildInfoRows({ internalCode: "A", assetType: { name: "T" }, supplier: { name: "S" } } as never, [{ label: "X", value: "1" }]);
    expect(rows.at(-1)).toEqual({ label: "X", value: "1" });
  });
});
