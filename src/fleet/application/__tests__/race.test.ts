import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../shared/domain/ports/unit-of-work";
import { InternalCodeTakenError, NameTakenError } from "../../domain/errors";
import type { FleetDeps } from "../deps";
import type { FleetTx } from "../ports/fleet-tx";
import { ArchiveAssetType } from "../use-cases/archive-asset-type";
import { ArchiveEquipment } from "../use-cases/archive-equipment";
import { ArchiveSupplier } from "../use-cases/archive-supplier";
import { CreateAssetType } from "../use-cases/create-asset-type";
import { CreateEquipment } from "../use-cases/create-equipment";
import { CreateSupplier } from "../use-cases/create-supplier";
import { RenameSupplier } from "../use-cases/rename-supplier";
import { RestoreAssetType } from "../use-cases/restore-asset-type";
import { RestoreEquipment } from "../use-cases/restore-equipment";
import { RestoreSupplier } from "../use-cases/restore-supplier";
import { UpdateAssetType } from "../use-cases/update-asset-type";
import { UpdateEquipment } from "../use-cases/update-equipment";
import { createHarness, type Harness } from "./support/harness";

/** Name and internal code lookups always miss: the pre-check lost a race to a concurrent writer. */
const blind = <T extends object>(repository: T): T =>
  Object.assign(Object.create(repository) as T, {
    findByName: () => Promise.resolve(null),
    findByInternalCode: () => Promise.resolve(null),
  });

const withTx = (h: Harness, change: (tx: FleetTx) => FleetTx): FleetDeps => {
  const unitOfWork: UnitOfWork<FleetTx> = { run: (work) => h.deps.unitOfWork.run((tx) => work(change(tx))) };
  return { ...h.deps, unitOfWork };
};

const racingDeps = (h: Harness): FleetDeps =>
  withTx(h, (tx) => ({ ...tx, suppliers: blind(tx.suppliers), assetTypes: blind(tx.assetTypes), equipment: blind(tx.equipment) }));

/** The write finds the row already in the requested state: a concurrent request changed it first. */
const staleWrites = <T extends object>(repository: T): T =>
  Object.assign(Object.create(repository) as T, { setArchivedAt: () => Promise.resolve("state_changed") });

const staleDeps = (h: Harness): FleetDeps =>
  withTx(h, (tx) => ({ ...tx, suppliers: staleWrites(tx.suppliers), assetTypes: staleWrites(tx.assetTypes), equipment: staleWrites(tx.equipment) }));

describe("the uniqueness race", () => {
  it("answers a typed conflict when the unique index rejects a create the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const deps = racingDeps(h);
    const before = h.audit.entries.length;
    const supplier = await new CreateSupplier(deps).execute({ actor: h.admin, name: " supplier a " });
    const type = await new CreateAssetType(deps).execute({ actor: h.admin, name: "forklift", meterKind: "hours", preventiveIntervalHours: null });
    const unit = await new CreateEquipment(deps).execute(h.equipmentInput(s.supplierA.id, s.container.id, "eq-0001"));
    expect(!supplier.ok && supplier.error).toBeInstanceOf(NameTakenError);
    expect(!type.ok && type.error).toBeInstanceOf(NameTakenError);
    expect(!unit.ok && unit.error).toBeInstanceOf(InternalCodeTakenError);
    expect(!unit.ok && unit.error.code).toBe("internal_code_taken");
    expect(h.audit.entries).toHaveLength(before);
    expect(await h.store.read((tx) => tx.equipment.listByTenant("t-a"))).toHaveLength(2);
  });

  it("answers a typed conflict when the unique index rejects a rename or an update the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const deps = racingDeps(h);
    const before = h.audit.entries.length;
    const rename = await new RenameSupplier(deps).execute({ actor: h.admin, id: s.supplierB.id, name: "supplier a" });
    const type = await new UpdateAssetType(deps).execute({
      actor: h.admin, id: s.container.id, name: "forklift", meterKind: "none", preventiveIntervalHours: null, reason: "Race",
    });
    const unit = await new UpdateEquipment(deps).execute({
      ...h.equipmentInput(s.supplierA.id, s.container.id, "EQ-0001"), id: s.c43.id, supplierId: s.supplierA.id, reason: "Race",
    });
    expect(!rename.ok && rename.error).toBeInstanceOf(NameTakenError);
    expect(!type.ok && type.error).toBeInstanceOf(NameTakenError);
    expect(!unit.ok && unit.error).toBeInstanceOf(InternalCodeTakenError);
    expect(h.audit.entries).toHaveLength(before);
    expect(await h.store.read((tx) => tx.equipment.findById("t-a", s.c43.id))).toEqual(s.c43);
  });

  it("answers a typed conflict when the partial index rejects a restore the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const input = { actor: h.analyst, reason: "Error" };
    await h.archiveSupplier.execute({ ...input, id: s.spare.id });
    h.orThrow(await h.createSupplier.execute({ actor: h.admin, name: "Spare" }));
    await h.archiveAssetType.execute({ ...input, id: s.spareType.id });
    h.orThrow(await h.createAssetType.execute({ actor: h.admin, name: "Spare type", meterKind: "km", preventiveIntervalHours: null }));
    await h.archiveEquipment.execute({ ...input, id: s.eq1.id });
    h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-0001")));
    const before = h.audit.entries.length;
    const deps = racingDeps(h);
    const restore = { actor: h.analyst, reason: "Volver" };
    const results = [
      await new RestoreSupplier(deps).execute({ ...restore, id: s.spare.id }),
      await new RestoreAssetType(deps).execute({ ...restore, id: s.spareType.id }),
      await new RestoreEquipment(deps).execute({ ...restore, id: s.eq1.id }),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual(["name_taken", "name_taken", "internal_code_taken"]);
    expect(h.audit.entries).toHaveLength(before);
  });
});

describe("the archive state race", () => {
  it("answers already_archived / not_archived when the write lost the race, without an audit entry", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    const before = h.audit.entries.length;
    const deps = staleDeps(h);
    const input = { actor: h.analyst, reason: "Otra vez" };
    const results = [
      await new ArchiveSupplier(deps).execute({ ...input, id: s.spare.id }),
      await new ArchiveAssetType(deps).execute({ ...input, id: s.spareType.id }),
      await new ArchiveEquipment(deps).execute({ ...input, id: s.c43.id }),
      await new RestoreEquipment(deps).execute({ ...input, id: s.eq1.id }),
      await new RestoreSupplier(deps).execute({ ...input, id: s.supplierB.id }),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual([
      "already_archived", "already_archived", "already_archived", "not_archived", "not_archived",
    ]);
    expect(h.audit.entries).toHaveLength(before);
  });
});

describe("row locks on the parents", () => {
  const recording = (h: Harness, calls: string[]): FleetDeps =>
    withTx(h, (tx) => {
      const spy = <T extends object>(repository: T, label: string): T =>
        Object.assign(Object.create(repository) as T, {
          lock: (_tenantId: string, id: string, mode: string) => {
            calls.push(`${label}:${id}:${mode}`);
            return Promise.resolve();
          },
        });
      return { ...tx, suppliers: spy(tx.suppliers, "supplier"), assetTypes: spy(tx.assetTypes, "asset_type") };
    });

  it("share-locks the supplier, then the asset type, before creating, editing or restoring equipment", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const calls: string[] = [];
    const deps = recording(h, calls);
    await new CreateEquipment(deps).execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "N-1"));
    const share = [`supplier:${s.supplierA.id}:share`, `asset_type:${s.forklift.id}:share`];
    expect(calls).toEqual(share);
    calls.length = 0;
    await new UpdateEquipment(deps).execute({ ...h.equipmentInput(s.supplierA.id, s.forklift.id, "N-2"), id: s.eq1.id, reason: "Fix" });
    expect(calls).toEqual(share);
    calls.length = 0;
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    await new RestoreEquipment(deps).execute({ actor: h.analyst, id: s.eq1.id, reason: "Volver" });
    expect(calls).toEqual(share);
  });

  it("takes the exclusive lock on the supplier or the asset type before archiving it", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const calls: string[] = [];
    const deps = recording(h, calls);
    await new ArchiveSupplier(deps).execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
    await new ArchiveAssetType(deps).execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
    expect(calls).toEqual([`supplier:${s.spare.id}:exclusive`, `asset_type:${s.spareType.id}:exclusive`]);
  });
});
