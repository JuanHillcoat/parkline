import { describe, expect, it } from "vitest";
import { InternalCodeTakenError, NameTakenError, ParentArchivedError } from "../../domain/errors";
import { actorWith, createHarness, grant } from "./support/harness";

const denied = ["manager", "supervisor", "viewer"];

describe("CreateSupplier", () => {
  it("stores the uppercase name, audits the creation without a reason", async () => {
    const h = createHarness();
    const result = await h.createSupplier.execute({ actor: h.admin, name: "  supplier   a " });
    expect(result.ok && result.value).toEqual({ id: "id-1", tenantId: "t-a", name: "SUPPLIER A", archivedAt: null });
    expect(h.auditOf("fleet.supplier.create")).toHaveLength(1);
    expect(h.auditOf("fleet.supplier.create")[0]).toMatchObject({
      entityType: "supplier",
      entityId: "id-1",
      actorRole: "admin",
      tenantId: "t-a",
      after: { name: "SUPPLIER A" },
    });
    expect(h.auditOf("fleet.supplier.create")[0]?.reason).toBeUndefined();
  });

  it("is allowed to the fleet analyst and refused to the roles without catalog.write", async () => {
    const h = createHarness();
    expect((await h.createSupplier.execute({ actor: h.analyst, name: "Supplier A" })).ok).toBe(true);
    for (const role of denied) {
      const result = await h.createSupplier.execute({ actor: actorWith([grant(role, "tenant", "t-a")]), name: "Other" });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    expect(await h.store.read((tx) => tx.suppliers.listByTenant("t-a"))).toHaveLength(1);
  });

  it("refuses an inactive actor and a blank or too long name", async () => {
    const h = createHarness();
    const inactive = await h.createSupplier.execute({ actor: { ...h.admin, active: false }, name: "Supplier A" });
    expect(!inactive.ok && inactive.error.code).toBe("forbidden");
    for (const name of ["  ", "n".repeat(121)]) {
      const result = await h.createSupplier.execute({ actor: h.admin, name });
      expect(!result.ok && result.error.code).toBe("invalid_name");
    }
    expect(h.audit.entries).toHaveLength(0);
  });

  it("conflicts on a name that differs only by case, spaces or accents, but not across tenants", async () => {
    const h = createHarness();
    await h.createSupplier.execute({ actor: h.admin, name: "Bahía Norte" });
    for (const name of ["bahia  norte", "BAHÍA NORTE"]) {
      const result = await h.createSupplier.execute({ actor: h.admin, name });
      expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
    }
    expect((await h.createSupplier.execute({ actor: h.adminB, name: "Bahía Norte" })).ok).toBe(true);
    expect(h.auditOf("fleet.supplier.create")).toHaveLength(2);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.createSupplier.execute({ actor: h.admin, name: "Supplier A" })).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.suppliers.listByTenant("t-a"))).toHaveLength(0);
  });
});

describe("CreateAssetType", () => {
  const input = (h: ReturnType<typeof createHarness>, overrides: object = {}) => ({
    actor: h.admin,
    name: " forklift ",
    meterKind: "hours",
    preventiveIntervalHours: 250,
    ...overrides,
  });

  it("stores the type and audits it", async () => {
    const h = createHarness();
    const result = await h.createAssetType.execute(input(h));
    expect(result.ok && result.value).toMatchObject({ name: "FORKLIFT", meterKind: "hours", preventiveIntervalHours: 250 });
    expect(h.auditOf("fleet.asset_type.create")[0]).toMatchObject({
      entityType: "asset_type",
      actorRole: "admin",
      after: { name: "FORKLIFT", meterKind: "hours", preventiveIntervalHours: 250 },
    });
  });

  it("refuses a meter-less type with an interval and the invalid values, each with its code", async () => {
    const h = createHarness();
    const codes: string[] = [];
    for (const override of [
      { meterKind: "none" },
      { meterKind: "miles" },
      { preventiveIntervalHours: 0 },
      { preventiveIntervalHours: 10001 },
      { name: " " },
    ]) {
      const result = await h.createAssetType.execute(input(h, override));
      codes.push(result.ok ? "ok" : result.error.code);
    }
    expect(codes).toEqual([
      "preventive_interval_not_allowed",
      "invalid_meter_kind",
      "invalid_preventive_interval",
      "invalid_preventive_interval",
      "invalid_name",
    ]);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("accepts a meter without interval, conflicts on the name and refuses viewers", async () => {
    const h = createHarness();
    expect((await h.createAssetType.execute(input(h, { preventiveIntervalHours: null }))).ok).toBe(true);
    const again = await h.createAssetType.execute(input(h, { name: "FORKLIFT" }));
    expect(!again.ok && again.error).toBeInstanceOf(NameTakenError);
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    const refused = await h.createAssetType.execute(input(h, { actor: viewer, name: "Other" }));
    expect(!refused.ok && refused.error.code).toBe("forbidden");
  });
});

describe("CreateEquipment", () => {
  it("stores the unit with normalized fields and audits ids and names", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.createEquipment.execute(
      h.equipmentInput(s.supplierA.id, s.forklift.id, " zx 037 ", {
        brand: " Brand X ", model: "M-1", year: 2020, serialNumber: "SN-1", batteryKind: "lead_acid", batteryQuantity: 2, observations: " note ",
      }),
    );
    expect(result.ok && result.value).toMatchObject({
      supplierId: s.supplierA.id, assetTypeId: s.forklift.id, internalCode: "ZX 037", brand: "Brand X",
      model: "M-1", year: 2020, serialNumber: "SN-1", batteryKind: "lead_acid", batteryQuantity: 2, observations: "note", archivedAt: null,
    });
    expect(h.auditOf("fleet.equipment.create").at(-1)).toMatchObject({
      entityType: "equipment",
      actorRole: "admin",
      after: {
        supplierId: s.supplierA.id, supplierName: "SUPPLIER A", assetTypeId: s.forklift.id, assetTypeName: "FORKLIFT",
        internalCode: "ZX 037", brand: "Brand X", model: "M-1", year: 2020, serialNumber: "SN-1",
        batteryKind: "lead_acid", batteryQuantity: 2, observations: "note",
      },
    });
  });

  it("refuses the roles without catalog.write, an inactive actor and a foreign tenant", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    for (const role of denied) {
      const actor = actorWith([grant(role, "tenant", "t-a")]);
      const result = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "N-1", { actor }));
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    const inactive = await h.createEquipment.execute(
      h.equipmentInput(s.supplierA.id, s.forklift.id, "N-1", { actor: { ...h.admin, active: false } }),
    );
    expect(!inactive.ok && inactive.error.code).toBe("forbidden");
    const foreign = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "N-1", { actor: h.adminB }));
    expect(!foreign.ok && foreign.error.code).toBe("not_found");
    expect(h.audit.entries).toHaveLength(before);
  });

  it("answers not found for an unknown supplier or asset type, checking the supplier first", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const noSupplier = await h.createEquipment.execute(h.equipmentInput("missing", "missing", "N-1"));
    const noType = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, "missing", "N-1"));
    expect(!noSupplier.ok && noSupplier.error.message).toContain("Supplier");
    expect(!noType.ok && noType.error.message).toContain("Asset type");
    expect(!noType.ok && noType.error.code).toBe("not_found");
  });

  it("refuses an archived supplier or asset type with parent_archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
    await h.archiveAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
    const bySupplier = await h.createEquipment.execute(h.equipmentInput(s.spare.id, s.forklift.id, "N-1"));
    const byType = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.spareType.id, "N-1"));
    expect(!bySupplier.ok && bySupplier.error).toBeInstanceOf(ParentArchivedError);
    expect(!byType.ok && byType.error.code).toBe("parent_archived");
  });

  it("reports every invalid field with its code and writes nothing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    const codes: string[] = [];
    for (const override of [
      { internalCode: " " }, { internalCode: "9".repeat(41) }, { brand: "b".repeat(121) }, { model: "m".repeat(121) },
      { brand: "  " }, { brand: null }, { model: "" }, { model: null },
      { year: 1949 }, { year: 2028 }, { serialNumber: "s".repeat(61) }, { batteryKind: "lead_acid", batteryQuantity: 5 }, { observations: "o".repeat(501) },
      { batteryKind: null }, { batteryKind: "" }, { batteryKind: "gas" }, { batteryKind: "lithium", batteryQuantity: 1 },
      { batteryKind: "combustion", batteryQuantity: 0 },
    ]) {
      const result = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "N-1", override));
      codes.push(result.ok ? "ok" : result.error.code);
    }
    expect(codes).toEqual([
      "invalid_internal_code", "invalid_internal_code", "invalid_text", "invalid_text",
      "invalid_text", "invalid_text", "invalid_text", "invalid_text",
      "invalid_year", "invalid_year", "invalid_text", "invalid_battery_quantity", "invalid_text",
      "invalid_battery_kind", "invalid_battery_kind", "invalid_battery_kind", "battery_quantity_not_allowed", "battery_quantity_not_allowed",
    ]);
    expect(h.audit.entries).toHaveLength(before);
  });

  it("accepts the year bounds 1950 and next year, and 0 or 4 batteries", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const create = (code: string, overrides: object) =>
      h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, code, overrides));
    expect((await create("Y1", { year: 1950, batteryKind: "lead_acid", batteryQuantity: 0 })).ok).toBe(true);
    expect((await create("Y2", { year: 2027, batteryKind: "lead_acid", batteryQuantity: 4 })).ok).toBe(true);
    expect((await create("Y3", { batteryKind: "lead_acid", batteryQuantity: null })).ok).toBe(true);
  });

  it.each(["lithium", "lead_acid", "combustion"])("stores the battery kind %s and audits it", async (batteryKind) => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "B-1", { batteryKind }));
    expect(result.ok && result.value).toMatchObject({ batteryKind, batteryQuantity: null });
    expect(h.auditOf("fleet.equipment.create").at(-1)).toMatchObject({ after: { batteryKind, batteryQuantity: null } });
  });

  it("allows the same internal code under two suppliers and refuses it under one", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const other = await h.createEquipment.execute(h.equipmentInput(s.supplierB.id, s.forklift.id, "EQ-0001"));
    expect(other.ok).toBe(true);
    for (const code of ["EQ-0001", "eq-0001", " eq-0001 "]) {
      const dup = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.container.id, code));
      expect(!dup.ok && dup.error).toBeInstanceOf(InternalCodeTakenError);
    }
  });

  it("frees the code of an archived unit and rolls back when the audit write fails", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-0001"))).rejects.toThrow("audit down");
    expect((await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-0001"))).ok).toBe(true);
    expect(await h.store.read((tx) => tx.equipment.listByTenant("t-a"))).toHaveLength(3);
  });
});
