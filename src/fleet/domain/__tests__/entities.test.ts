import { describe, expect, it } from "vitest";
import { createAssetType, createEquipment, createSupplier } from "../entities";

const equipment = {
  id: "e1",
  tenantId: "t-a",
  supplierId: "s1",
  assetTypeId: "a1",
  internalCode: " c-043 ",
  brand: "Brand X",
  model: "Model Y",
  year: null,
  serialNumber: null,
  batteryKind: "combustion",
  batteryQuantity: null,
  observations: null,
};

const assetType = { id: "a1", tenantId: "t-a", name: "forklift", meterKind: "hours", preventiveIntervalHours: 250 };

describe("createSupplier", () => {
  it("normalizes the name and starts active", () => {
    const result = createSupplier({ id: "s1", tenantId: "t-a", name: " supplier  a " });
    expect(result).toEqual({ ok: true, value: { id: "s1", tenantId: "t-a", name: "SUPPLIER A", archivedAt: null } });
  });

  it("rejects a blank name and keeps a given archivedAt", () => {
    const blank = createSupplier({ id: "s1", tenantId: "t-a", name: " " });
    expect(!blank.ok && blank.error.code).toBe("invalid_name");
    const at = new Date("2026-01-01T00:00:00Z");
    expect(createSupplier({ id: "s1", tenantId: "t-a", name: "x", archivedAt: at })).toMatchObject({
      ok: true,
      value: { archivedAt: at },
    });
  });
});

describe("createAssetType", () => {
  it("normalizes the name and accepts an interval for a meter", () => {
    expect(createAssetType(assetType)).toEqual({
      ok: true,
      value: { ...assetType, name: "FORKLIFT", archivedAt: null },
    });
    expect(createAssetType({ ...assetType, meterKind: "km", preventiveIntervalHours: null }).ok).toBe(true);
  });

  it("allows no interval for the kind none and refuses one", () => {
    expect(createAssetType({ ...assetType, meterKind: "none", preventiveIntervalHours: null }).ok).toBe(true);
    const refused = createAssetType({ ...assetType, meterKind: "none" });
    expect(!refused.ok && refused.error.code).toBe("preventive_interval_not_allowed");
  });

  it("reports the first invalid value with its typed code", () => {
    const codes = [
      { name: " " },
      { meterKind: "miles" },
      { preventiveIntervalHours: 0 },
    ].map((override) => {
      const result = createAssetType({ ...assetType, ...override });
      return result.ok ? "ok" : result.error.code;
    });
    expect(codes).toEqual(["invalid_name", "invalid_meter_kind", "invalid_preventive_interval"]);
  });
});

describe("createEquipment", () => {
  it("normalizes the code, trims the optional text and starts active", () => {
    const result = createEquipment(
      { ...equipment, brand: " Brand X ", model: " Model Y ", serialNumber: " sn-1 ", observations: " ok ", year: 2020, batteryKind: "lead_acid", batteryQuantity: 2 },
      2026,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        ...equipment,
        internalCode: "C-043",
        serialNumber: "sn-1",
        observations: "ok",
        year: 2020,
        batteryKind: "lead_acid",
        batteryQuantity: 2,
        archivedAt: null,
      },
    });
  });

  it("validates every field with its own typed code", () => {
    const codes = [
      { internalCode: " " },
      { brand: "b".repeat(121) },
      { model: "m".repeat(121) },
      { year: 1949 },
      { serialNumber: "s".repeat(61) },
      { batteryKind: "lead_acid", batteryQuantity: 5 },
      { observations: "o".repeat(501) },
    ].map((override) => {
      const result = createEquipment({ ...equipment, ...override }, 2026);
      return result.ok ? "ok" : result.error.code;
    });
    expect(codes).toEqual([
      "invalid_internal_code",
      "invalid_text",
      "invalid_text",
      "invalid_year",
      "invalid_text",
      "invalid_battery_quantity",
      "invalid_text",
    ]);
  });

  it("requires a brand and a model: blank or missing is rejected with the field", () => {
    const rejected = [{ brand: null }, { brand: "  " }, { model: null }, { model: "" }].map((override) => {
      const result = createEquipment({ ...equipment, ...override }, 2026);
      return result.ok ? "ok" : `${result.error.code}:${result.error.field ?? ""}`;
    });
    expect(rejected).toEqual(["invalid_text:brand", "invalid_text:brand", "invalid_text:model", "invalid_text:model"]);
  });

  it.each(["lithium", "lead_acid", "combustion"])("accepts the battery kind %s", (batteryKind) => {
    const result = createEquipment({ ...equipment, batteryKind }, 2026);
    expect(result.ok && result.value.batteryKind).toBe(batteryKind);
  });

  it.each([null, "", "  ", "gas", "Lithium"])("requires a known battery kind: %j is rejected with the field", (batteryKind) => {
    const result = createEquipment({ ...equipment, batteryKind }, 2026);
    expect(!result.ok && `${result.error.code}:${result.error.field ?? ""}`).toBe("invalid_battery_kind:batteryKind");
  });

  it.each(["lithium", "combustion"])("rejects a battery quantity for %s, even zero", (batteryKind) => {
    for (const batteryQuantity of [0, 2]) {
      const result = createEquipment({ ...equipment, batteryKind, batteryQuantity }, 2026);
      expect(!result.ok && `${result.error.code}:${result.error.field ?? ""}`).toBe("battery_quantity_not_allowed:batteryQuantity");
    }
  });

  it("keeps the quantity optional for lead acid", () => {
    expect(createEquipment({ ...equipment, batteryKind: "lead_acid", batteryQuantity: null }, 2026).ok).toBe(true);
    expect(createEquipment({ ...equipment, batteryKind: "lead_acid", batteryQuantity: 0 }, 2026).ok).toBe(true);
  });

  it("uses the injected current year for the year bound", () => {
    expect(createEquipment({ ...equipment, year: 2027 }, 2026).ok).toBe(true);
    expect(createEquipment({ ...equipment, year: 2027 }, 2025).ok).toBe(false);
  });
});
