import { describe, expect, it } from "vitest";
import { ReasonRequiredError, ReasonTooLongError } from "../../domain/errors";
import { MAX_REASON_LENGTH } from "../reason";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

describe("RenameSupplier", () => {
  it("renames without a reason and audits the previous and new name", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.renameSupplier.execute({ actor: h.admin, id: s.supplierA.id, name: " supplier  aa " });
    expect(result.ok && result.value.name).toBe("SUPPLIER AA");
    expect(h.auditOf("fleet.supplier.rename")[0]).toMatchObject({
      entityType: "supplier", entityId: s.supplierA.id, before: { name: "SUPPLIER A" }, after: { name: "SUPPLIER AA" },
    });
    expect(h.auditOf("fleet.supplier.rename")[0]?.reason).toBeUndefined();
  });

  it("lets a row change only its case, refuses a taken name, a blank name and archived rows", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    expect((await h.renameSupplier.execute({ actor: h.admin, id: s.supplierA.id, name: "supplier a" })).ok).toBe(true);
    const taken = await h.renameSupplier.execute({ actor: h.admin, id: s.supplierA.id, name: "supplier b" });
    const blank = await h.renameSupplier.execute({ actor: h.admin, id: s.supplierA.id, name: "  " });
    expect(!taken.ok && taken.error.code).toBe("name_taken");
    expect(!blank.ok && blank.error.code).toBe("invalid_name");
    await h.archiveSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
    const archived = await h.renameSupplier.execute({ actor: h.admin, id: s.spare.id, name: "Other" });
    expect(!archived.ok && archived.error.code).toBe("archived");
  });

  it("refuses manager and viewer, other tenants and inactive actors", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    for (const role of ["manager", "viewer"]) {
      const actor = actorWith([grant(role, "tenant", "t-a")]);
      const result = await h.renameSupplier.execute({ actor, id: s.supplierA.id, name: "Other" });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    const foreign = await h.renameSupplier.execute({ actor: h.adminB, id: s.supplierA.id, name: "Other" });
    const inactive = await h.renameSupplier.execute({ actor: { ...h.admin, active: false }, id: s.supplierA.id, name: "Other" });
    expect(!foreign.ok && foreign.error.code).toBe("not_found");
    expect(!inactive.ok && inactive.error.code).toBe("forbidden");
    expect(h.audit.entries).toHaveLength(before);
  });
});

const typeEdit = (h: Harness, id: string, overrides: object = {}) => ({
  actor: h.admin, id, name: "Forklift", meterKind: "hours", preventiveIntervalHours: 250, reason: "Corrected", ...overrides,
});

describe("UpdateAssetType", () => {
  it("changes name, meter kind and interval with a reason, auditing before and after", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.updateAssetType.execute(
      typeEdit(h, s.forklift.id, { name: "Electric forklift", meterKind: "km", preventiveIntervalHours: 500, reason: "  New spec " }),
    );
    expect(result.ok && result.value).toMatchObject({ name: "ELECTRIC FORKLIFT", meterKind: "km", preventiveIntervalHours: 500 });
    expect(h.auditOf("fleet.asset_type.update")[0]).toMatchObject({
      entityType: "asset_type",
      entityId: s.forklift.id,
      actorRole: "admin",
      reason: "New spec",
      before: { name: "FORKLIFT", meterKind: "hours", preventiveIntervalHours: 250 },
      after: { name: "ELECTRIC FORKLIFT", meterKind: "km", preventiveIntervalHours: 500 },
    });
  });

  it("requires a visible reason of at most 500 characters before anything else is written", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    for (const reason of ["", "   ", "​ "]) {
      const result = await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { name: "Other", reason }));
      expect(!result.ok && result.error).toBeInstanceOf(ReasonRequiredError);
    }
    const long = await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { name: "Other", reason: "r".repeat(MAX_REASON_LENGTH + 1) }));
    expect(!long.ok && long.error).toBeInstanceOf(ReasonTooLongError);
    const exact = await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { name: "Other", reason: ` ${"r".repeat(MAX_REASON_LENGTH)} ` }));
    expect(exact.ok).toBe(true);
    expect(h.auditOf("fleet.asset_type.update")).toHaveLength(1);
  });

  it("answers no_changes when nothing differs and writes nothing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    const result = await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { name: " forklift " }));
    expect(!result.ok && result.error.code).toBe("no_changes");
    expect(h.audit.entries).toHaveLength(before);
  });

  it("refuses an interval for the kind none, a taken name and invalid values", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const codes: string[] = [];
    for (const override of [
      { meterKind: "none" }, { name: "container" }, { meterKind: "miles" }, { preventiveIntervalHours: -5 }, { name: "" },
    ]) {
      const result = await h.updateAssetType.execute(typeEdit(h, s.forklift.id, override));
      codes.push(result.ok ? "ok" : result.error.code);
    }
    expect(codes).toEqual([
      "preventive_interval_not_allowed", "name_taken", "invalid_meter_kind", "invalid_preventive_interval", "invalid_name",
    ]);
    const cleared = await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { meterKind: "none", preventiveIntervalHours: null }));
    expect(cleared.ok).toBe(true);
  });

  it("refuses viewers, other tenants, unknown ids and archived rows", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    const results = [
      await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { actor: viewer, name: "Other" })),
      await h.updateAssetType.execute(typeEdit(h, s.forklift.id, { actor: h.adminB, name: "Other" })),
      await h.updateAssetType.execute(typeEdit(h, "missing", { name: "Other" })),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["forbidden", "not_found", "not_found"]);
    await h.archiveAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
    const archived = await h.updateAssetType.execute(typeEdit(h, s.spareType.id, { name: "Other", meterKind: "km" }));
    expect(!archived.ok && archived.error.code).toBe("archived");
  });
});

const equipmentEdit = (h: Harness, s: Awaited<ReturnType<Harness["seedTenantA"]>>, overrides: object = {}) => ({
  actor: h.admin,
  id: s.eq1.id,
  supplierId: s.supplierA.id,
  assetTypeId: s.forklift.id,
  internalCode: "EQ-0001",
  brand: null,
  model: null,
  year: null,
  serialNumber: null,
  batteryQuantity: null,
  observations: null,
  reason: "Corrected",
  ...overrides,
});

describe("UpdateEquipment", () => {
  it("changes every field including supplier and type, auditing before and after with names", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.updateEquipment.execute(
      equipmentEdit(h, s, {
        supplierId: s.supplierB.id, assetTypeId: s.container.id, internalCode: " eq-9 ", brand: "Brand X", model: "M-1",
        year: 2019, serialNumber: "SN-9", batteryQuantity: 1, observations: "Moved", reason: " Re-assigned ",
      }),
    );
    expect(result.ok && result.value).toMatchObject({ id: s.eq1.id, supplierId: s.supplierB.id, internalCode: "EQ-9", year: 2019 });
    expect(h.auditOf("fleet.equipment.update")[0]).toMatchObject({
      entityType: "equipment",
      entityId: s.eq1.id,
      reason: "Re-assigned",
      before: { supplierId: s.supplierA.id, supplierName: "SUPPLIER A", assetTypeName: "FORKLIFT", internalCode: "EQ-0001", brand: null },
      after: {
        supplierId: s.supplierB.id, supplierName: "SUPPLIER B", assetTypeId: s.container.id, assetTypeName: "CONTAINER",
        internalCode: "EQ-9", brand: "Brand X", model: "M-1", year: 2019, serialNumber: "SN-9", batteryQuantity: 1, observations: "Moved",
      },
    });
  });

  it("requires a reason, answers no_changes for equal values and keeps the previous data", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const blank = await h.updateEquipment.execute(equipmentEdit(h, s, { brand: "X", reason: " " }));
    const long = await h.updateEquipment.execute(equipmentEdit(h, s, { brand: "X", reason: "r".repeat(501) }));
    const same = await h.updateEquipment.execute(equipmentEdit(h, s, { internalCode: " eq-0001 ", brand: "  " }));
    expect(!blank.ok && blank.error.code).toBe("reason_required");
    expect(!long.ok && long.error.code).toBe("reason_too_long");
    expect(!same.ok && same.error.code).toBe("no_changes");
    expect(h.auditOf("fleet.equipment.update")).toHaveLength(0);
    expect(await h.store.read((tx) => tx.equipment.findById("t-a", s.eq1.id))).toEqual(s.eq1);
  });

  it("refuses a code used by another unit of the supplier, but allows it under another supplier", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-0002")));
    const taken = await h.updateEquipment.execute(equipmentEdit(h, s, { internalCode: "eq-0002" }));
    expect(!taken.ok && taken.error.code).toBe("internal_code_taken");
    const moved = await h.updateEquipment.execute(equipmentEdit(h, s, { supplierId: s.supplierB.id, internalCode: "eq-0002" }));
    expect(moved.ok).toBe(true);
    const clash = await h.updateEquipment.execute(equipmentEdit(h, s, { supplierId: s.supplierB.id, internalCode: "C-043" }));
    expect(!clash.ok && clash.error.code).toBe("internal_code_taken");
  });

  it("refuses an archived or unknown target supplier or type, and invalid values", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
    await h.archiveAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
    const codes: string[] = [];
    for (const override of [
      { supplierId: s.spare.id }, { assetTypeId: s.spareType.id }, { supplierId: "missing" }, { assetTypeId: "missing" },
      { internalCode: "" }, { year: 1900 }, { batteryQuantity: 9 }, { brand: "b".repeat(121) },
    ]) {
      const result = await h.updateEquipment.execute(equipmentEdit(h, s, override));
      codes.push(result.ok ? "ok" : result.error.code);
    }
    expect(codes).toEqual([
      "parent_archived", "parent_archived", "not_found", "not_found",
      "invalid_internal_code", "invalid_year", "invalid_battery_quantity", "invalid_text",
    ]);
  });

  it("refuses viewers, other tenants, unknown ids and archived equipment, writing nothing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Error" });
    const before = h.audit.entries.length;
    const results = [
      await h.updateEquipment.execute(equipmentEdit(h, s, { actor: viewer, brand: "X" })),
      await h.updateEquipment.execute(equipmentEdit(h, s, { actor: h.adminB, brand: "X" })),
      await h.updateEquipment.execute(equipmentEdit(h, s, { id: "missing", brand: "X" })),
      await h.updateEquipment.execute(equipmentEdit(h, s, { id: s.c43.id, brand: "X" })),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["forbidden", "not_found", "not_found", "archived"]);
    expect(h.audit.entries).toHaveLength(before);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.updateEquipment.execute(equipmentEdit(h, s, { brand: "X" }))).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.equipment.findById("t-a", s.eq1.id))).toEqual(s.eq1);
  });
});
