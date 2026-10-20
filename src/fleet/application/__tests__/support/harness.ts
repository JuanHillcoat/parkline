import type { Actor, Grant } from "../../../../shared/domain/ports/access-policy";
import { FixedClock } from "../../../../shared/infrastructure/fixed-clock";
import { InMemoryAuditLog } from "../../../../shared/infrastructure/in-memory-audit-log";
import { SequentialIdGenerator } from "../../../../shared/infrastructure/sequential-id-generator";
import { InMemoryFleetStore } from "../../../infrastructure/in-memory-fleet-store";
import { FakeAccessPolicy } from "../../../__tests__/support/fake-access-policy";
import type { FleetDeps } from "../../deps";
import { ArchiveAssetType } from "../../use-cases/archive-asset-type";
import { ArchiveEquipment } from "../../use-cases/archive-equipment";
import { ArchiveSupplier } from "../../use-cases/archive-supplier";
import { CreateAssetType } from "../../use-cases/create-asset-type";
import { CreateEquipment, type CreateEquipmentInput } from "../../use-cases/create-equipment";
import { CreateSupplier } from "../../use-cases/create-supplier";
import { ListAssetTypes } from "../../use-cases/list-asset-types";
import { ListEquipment } from "../../use-cases/list-equipment";
import { ListSuppliers } from "../../use-cases/list-suppliers";
import { RenameSupplier } from "../../use-cases/rename-supplier";
import { RestoreAssetType } from "../../use-cases/restore-asset-type";
import { RestoreEquipment } from "../../use-cases/restore-equipment";
import { RestoreSupplier } from "../../use-cases/restore-supplier";
import { UpdateAssetType } from "../../use-cases/update-asset-type";
import { UpdateEquipment } from "../../use-cases/update-equipment";

export const START = new Date("2026-01-01T09:00:00Z");

export const actorWith = (
  grants: readonly Grant[],
  overrides: Partial<Pick<Actor, "tenantId" | "active" | "userId">> = {},
): Actor => ({ userId: "user-1", tenantId: "t-a", active: true, grants, ...overrides });

export const grant = (role: string, scopeType: string, scopeId: string): Grant => ({
  role,
  scopeType,
  scopeId,
});

export const createHarness = () => {
  const audit = new InMemoryAuditLog();
  const store = new InMemoryFleetStore(audit);
  const deps: FleetDeps = {
    unitOfWork: store.unitOfWork(),
    clock: new FixedClock(START),
    ids: new SequentialIdGenerator("id"),
    accessPolicy: new FakeAccessPolicy(),
  };
  const useCases = {
    createSupplier: new CreateSupplier(deps),
    renameSupplier: new RenameSupplier(deps),
    createAssetType: new CreateAssetType(deps),
    updateAssetType: new UpdateAssetType(deps),
    createEquipment: new CreateEquipment(deps),
    updateEquipment: new UpdateEquipment(deps),
    archiveSupplier: new ArchiveSupplier(deps),
    restoreSupplier: new RestoreSupplier(deps),
    archiveAssetType: new ArchiveAssetType(deps),
    restoreAssetType: new RestoreAssetType(deps),
    archiveEquipment: new ArchiveEquipment(deps),
    restoreEquipment: new RestoreEquipment(deps),
    listSuppliers: new ListSuppliers(deps),
    listAssetTypes: new ListAssetTypes(deps),
    listEquipment: new ListEquipment(deps),
  };

  const admin = actorWith([grant("admin", "tenant", "t-a")]);
  /** The only role that archives and restores (`catalog.archive`), at tenant scope. */
  const analyst = actorWith([grant("fleet_analyst", "tenant", "t-a")]);
  const analystB = actorWith([grant("fleet_analyst", "tenant", "t-b")], { tenantId: "t-b" });
  const adminB = actorWith([grant("admin", "tenant", "t-b")], { tenantId: "t-b" });
  const orThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
    if (!result.ok) throw result.error;
    return result.value;
  };

  /** The create input of an equipment with every optional field empty; override what a test needs. */
  const equipmentInput = (
    supplierId: string,
    assetTypeId: string,
    internalCode: string,
    overrides: Partial<CreateEquipmentInput> = {},
  ): CreateEquipmentInput => ({
    actor: admin,
    supplierId,
    assetTypeId,
    internalCode,
    brand: null,
    model: null,
    year: null,
    serialNumber: null,
    batteryQuantity: null,
    observations: null,
    ...overrides,
  });

  /**
   * Tenant A: suppliers SUPPLIER A and SUPPLIER B; asset types FORKLIFT (hours, 250) and CONTAINER
   * (no meter); EQ-0001 (A, forklift) and C-043 (B, container). Spare has no equipment.
   */
  const seedTenantA = async () => {
    const supplier = async (name: string) => orThrow(await useCases.createSupplier.execute({ actor: admin, name }));
    const supplierA = await supplier("Supplier A");
    const supplierB = await supplier("Supplier B");
    const spare = await supplier("Spare");
    const type = async (name: string, meterKind: string, preventiveIntervalHours: number | null) =>
      orThrow(await useCases.createAssetType.execute({ actor: admin, name, meterKind, preventiveIntervalHours }));
    const forklift = await type("Forklift", "hours", 250);
    const container = await type("Container", "none", null);
    const spareType = await type("Spare type", "km", null);
    const eq1 = orThrow(await useCases.createEquipment.execute(equipmentInput(supplierA.id, forklift.id, "EQ-0001")));
    const c43 = orThrow(await useCases.createEquipment.execute(equipmentInput(supplierB.id, container.id, "c-043")));
    return { supplierA, supplierB, spare, forklift, container, spareType, eq1, c43 };
  };

  const auditOf = (action: string) => audit.entries.filter((entry) => entry.action === action);

  return { audit, store, deps, admin, adminB, analyst, analystB, auditOf, orThrow, equipmentInput, seedTenantA, ...useCases };
};

export type Harness = ReturnType<typeof createHarness>;
