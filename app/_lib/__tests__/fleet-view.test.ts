import { describe, expect, it } from "vitest";
import type { AssetType, Equipment, Supplier } from "../../../src/fleet/domain/entities";
import {
  assetTypeOptions,
  buildAssetTypeRows,
  buildEquipmentRows,
  buildSupplierRows,
  canCreateEquipment,
  countActiveEquipment,
  equipmentFormValues,
  fleetToggleHref,
  intervalText,
  supplierOptions,
} from "../fleet-view";

const GONE = new Date("2026-01-01T00:00:00Z");
const supplier = (id: string, name: string, archivedAt: Date | null = null): Supplier => ({ id, tenantId: "t", name, archivedAt });
const assetType = (
  id: string,
  name: string,
  meterKind: AssetType["meterKind"] = "hours",
  preventiveIntervalHours: number | null = 250,
  archivedAt: Date | null = null,
): AssetType => ({ id, tenantId: "t", name, meterKind, preventiveIntervalHours, archivedAt });
const equipment = (id: string, code: string, supplierId: string, assetTypeId: string, extra: Partial<Equipment> = {}): Equipment => ({
  id,
  tenantId: "t",
  supplierId,
  assetTypeId,
  internalCode: code,
  brand: null,
  model: null,
  year: null,
  serialNumber: null,
  batteryQuantity: null,
  observations: null,
  archivedAt: null,
  ...extra,
});

const suppliers = [supplier("s1", "SUPPLIER A"), supplier("s2", "SUPPLIER B")];
const types = [assetType("a1", "FORKLIFT"), assetType("a2", "PALLET JACK", "none", null)];
const units = [
  equipment("e1", "EQ-0001", "s1", "a1", { brand: "BRAND X", model: "M-1", year: 2020, serialNumber: "SN-1", batteryQuantity: 2, observations: "Left mast" }),
  equipment("e2", "C-043", "s1", "a2"),
  equipment("e3", "EQ-0003", "s2", "a1", { archivedAt: GONE }),
];

describe("intervalText", () => {
  it("shows the interval with the unit of the meter", () => {
    expect(intervalText("hours", 250)).toBe("250 h");
    expect(intervalText("km", 10000)).toBe("10000 km");
  });

  it("shows a dash without a meter or without an interval", () => {
    expect(intervalText("none", null)).toBe("—");
    expect(intervalText("hours", null)).toBe("—");
  });
});

describe("countActiveEquipment", () => {
  it("counts only the active equipment per supplier and per asset type", () => {
    expect(countActiveEquipment(units, "supplierId").get("s1")).toBe(2);
    expect(countActiveEquipment(units, "supplierId").get("s2")).toBeUndefined();
    expect(countActiveEquipment(units, "assetTypeId").get("a1")).toBe(1);
  });
});

describe("buildSupplierRows and buildAssetTypeRows", () => {
  it("carry the active equipment count and the archived flag", () => {
    const rows = buildSupplierRows([...suppliers, supplier("s3", "SUPPLIER C", GONE)], units);
    expect(rows.map((r) => [r.name, r.activeEquipment, r.archived])).toEqual([
      ["SUPPLIER A", 2, false],
      ["SUPPLIER B", 0, false],
      ["SUPPLIER C", 0, true],
    ]);
  });

  it("translate the meter, show the interval and prepare the edit values", () => {
    const [forklift, jack] = buildAssetTypeRows(types, units);
    expect(forklift).toMatchObject({ meterLabel: "Horas", intervalText: "250 h", activeEquipment: 1 });
    expect(forklift?.form).toEqual({ name: "FORKLIFT", meterKind: "hours", interval: "250" });
    expect(jack).toMatchObject({ meterLabel: "Ninguno", intervalText: "—" });
    expect(jack?.form).toEqual({ name: "PALLET JACK", meterKind: "none", interval: "" });
  });
});

describe("buildEquipmentRows", () => {
  const rows = buildEquipmentRows(units, suppliers, types);

  it("resolves the supplier and the asset type by id", () => {
    expect(rows[0]).toMatchObject({ internalCode: "EQ-0001", supplierName: "SUPPLIER A", assetTypeName: "FORKLIFT" });
  });

  it("joins brand and model, and leaves null when both are missing", () => {
    expect(rows[0]?.brandModel).toBe("BRAND X M-1");
    expect(rows[1]?.brandModel).toBeNull();
  });

  it("keeps the archived flag and leaves unknown parents as null", () => {
    expect(rows[2]?.archived).toBe(true);
    const lonely = buildEquipmentRows([equipment("e9", "EQ-0009", "gone", "gone")], suppliers, types);
    expect(lonely[0]).toMatchObject({ supplierName: null, assetTypeName: null });
  });
});

describe("equipmentFormValues", () => {
  it("turns every field into the text a form shows, blank for missing values", () => {
    expect(equipmentFormValues(units[0] as Equipment)).toEqual({
      internalCode: "EQ-0001",
      supplierId: "s1",
      assetTypeId: "a1",
      brand: "BRAND X",
      model: "M-1",
      year: "2020",
      serialNumber: "SN-1",
      batteryQuantity: "2",
      observations: "Left mast",
    });
    expect(equipmentFormValues(units[1] as Equipment)).toMatchObject({ brand: "", year: "", batteryQuantity: "" });
  });

  it("keeps a battery quantity of zero", () => {
    expect(equipmentFormValues(equipment("e", "X", "s", "a", { batteryQuantity: 0 })).batteryQuantity).toBe("0");
  });
});

describe("select options", () => {
  it("offer only active suppliers and asset types", () => {
    const all = [...suppliers, supplier("s3", "SUPPLIER C", GONE)];
    expect(supplierOptions(all)).toEqual([{ id: "s1", name: "SUPPLIER A" }, { id: "s2", name: "SUPPLIER B" }]);
    expect(assetTypeOptions([...types, assetType("a3", "OLD", "none", null, GONE)]).map((o) => o.id)).toEqual(["a1", "a2"]);
  });

  it("allow a new equipment only with at least one of each", () => {
    expect(canCreateEquipment(supplierOptions(suppliers), assetTypeOptions(types))).toBe(true);
    expect(canCreateEquipment([], assetTypeOptions(types))).toBe(false);
    expect(canCreateEquipment(supplierOptions(suppliers), [])).toBe(false);
  });
});

describe("fleetToggleHref", () => {
  it("leads to the other view", () => {
    expect(fleetToggleHref(false)).toBe("/fleet?archived=1");
    expect(fleetToggleHref(true)).toBe("/fleet");
  });
});
