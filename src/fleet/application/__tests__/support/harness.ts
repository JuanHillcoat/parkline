import type { Actor, Grant } from "../../../../shared/domain/ports/access-policy";
import { FixedClock } from "../../../../shared/infrastructure/fixed-clock";
import { InMemoryAuditLog } from "../../../../shared/infrastructure/in-memory-audit-log";
import { SequentialIdGenerator } from "../../../../shared/infrastructure/sequential-id-generator";
import { InMemoryFleetStore } from "../../../infrastructure/in-memory-fleet-store";
import { FakeAccessPolicy } from "../../../__tests__/support/fake-access-policy";
import { FakeInitialReadingRecorder } from "../../../__tests__/support/fake-initial-reading-recorder";
import { FakeOperationDirectory } from "../../../__tests__/support/fake-operation-directory";
import type { FleetDeps } from "../../deps";
import { ArchiveAssetType } from "../../use-cases/archive-asset-type";
import { ArchiveEquipment } from "../../use-cases/archive-equipment";
import { ArchiveSupplier } from "../../use-cases/archive-supplier";
import { AssignEquipment } from "../../use-cases/assign-equipment";
import { CorrectAssignment } from "../../use-cases/correct-assignment";
import { EndAssignment } from "../../use-cases/end-assignment";
import { ListEquipmentAssignments } from "../../use-cases/list-equipment-assignments";
import { MoveEquipment } from "../../use-cases/move-equipment";
import { ReplaceEquipment } from "../../use-cases/replace-equipment";
import { CreateAssetType } from "../../use-cases/create-asset-type";
import { CreateEquipment, type CreateEquipmentInput } from "../../use-cases/create-equipment";
import { CreateSupplier } from "../../use-cases/create-supplier";
import { ListAssetTypes } from "../../use-cases/list-asset-types";
import { GetEquipment } from "../../use-cases/get-equipment";
import { GetEquipmentImage } from "../../use-cases/get-equipment-image";
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

/**
 * Operations of the fake organization. OP1 and OP2 share the division BU1 (sites S1 and S2); OP3 is in
 * BU2 (site S3); OPX is archived; OPB belongs to tenant t-b.
 */
const seedOperations = (): FakeOperationDirectory => {
  const directory = new FakeOperationDirectory();
  const row = (tenantId: string, id: string, businessUnitId: string, siteId: string) =>
    directory.add({ tenantId, id, businessUnitId, siteId, archivedAt: null });
  row("t-a", "op1", "bu1", "s1");
  row("t-a", "op2", "bu1", "s2");
  row("t-a", "op3", "bu2", "s3");
  row("t-a", "opx", "bu1", "s1");
  row("t-b", "opb", "bu-b", "s-b");
  directory.archive("opx", START);
  return directory;
};

export const createHarness = () => {
  const audit = new InMemoryAuditLog();
  const operations = seedOperations();
  const store = new InMemoryFleetStore(audit, operations);
  const clock = new FixedClock(START);
  const initialReadings = new FakeInitialReadingRecorder(clock);
  const deps: FleetDeps = {
    unitOfWork: store.unitOfWork(),
    initialReadings,
    clock,
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
    getEquipment: new GetEquipment(deps),
    getEquipmentImage: new GetEquipmentImage(deps),
    assignEquipment: new AssignEquipment(deps),
    moveEquipment: new MoveEquipment(deps),
    replaceEquipment: new ReplaceEquipment(deps),
    endAssignment: new EndAssignment(deps),
    correctAssignment: new CorrectAssignment(deps),
    listEquipmentAssignments: new ListEquipmentAssignments(deps),
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

  /** The create input of an equipment with a brand and a model and every optional field empty; override what a test needs. */
  const equipmentInput = (
    supplierId: string,
    assetTypeId: string,
    internalCode: string,
    overrides: Partial<CreateEquipmentInput> = {},
  ): Omit<CreateEquipmentInput, "image"> => ({
    actor: admin,
    supplierId,
    assetTypeId,
    internalCode,
    brand: "Brand",
    model: "Model",
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

  /** A fleet analyst limited to one operation: writes there, never archives (archive is tenant-wide). */
  const analystAt = (operationId: string) => actorWith([grant("fleet_analyst", "operation", operationId)]);
  /** An admin limited to one operation: writes there only. */
  const adminAt = (operationId: string) => actorWith([grant("admin", "operation", operationId)]);

  /** Assigns as the admin and returns the stored assignment; override any input a test needs. */
  const assign = async (
    equipmentId: string,
    operationId: string,
    day: string,
    overrides: Partial<Parameters<AssignEquipment["execute"]>[0]> = {},
  ) => orThrow(await useCases.assignEquipment.execute({ actor: admin, equipmentId, operationId, kind: "active", day, ...overrides }));

  /** Every assignment of an equipment of tenant A, newest first, read from the committed state. */
  const assignmentsOf = (equipmentId: string) => store.read((tx) => tx.assignments.listByEquipment("t-a", equipmentId));

  const auditOf = (action: string) => audit.entries.filter((entry) => entry.action === action);

  return { audit, store, deps, initialReadings, clock, operations, assign, assignmentsOf, analystAt, adminAt, admin, adminB, analyst, analystB, auditOf, orThrow, equipmentInput, seedTenantA, ...useCases };
};

export type Harness = ReturnType<typeof createHarness>;
