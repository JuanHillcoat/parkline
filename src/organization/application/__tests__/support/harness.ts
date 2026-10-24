import type { Actor, Grant } from "../../../../shared/domain/ports/access-policy";
import { FixedClock } from "../../../../shared/infrastructure/fixed-clock";
import { InMemoryAuditLog } from "../../../../shared/infrastructure/in-memory-audit-log";
import { SequentialIdGenerator } from "../../../../shared/infrastructure/sequential-id-generator";
import { InMemoryOrganizationStore } from "../../../infrastructure/in-memory-organization-store";
import { FakeAccessPolicy } from "../../../__tests__/support/fake-access-policy";
import { FakeAssignmentDirectory } from "../../../__tests__/support/fake-assignment-directory";
import type { OrganizationDeps } from "../../deps";
import { CreateBusinessUnit } from "../../use-cases/create-business-unit";
import { CreateOperation } from "../../use-cases/create-operation";
import { ArchiveBusinessUnit } from "../../use-cases/archive-business-unit";
import { ArchiveOperation } from "../../use-cases/archive-operation";
import { ArchiveSite } from "../../use-cases/archive-site";
import { CreateSite } from "../../use-cases/create-site";
import { RestoreBusinessUnit } from "../../use-cases/restore-business-unit";
import { RestoreOperation } from "../../use-cases/restore-operation";
import { RestoreSite } from "../../use-cases/restore-site";
import { ListBusinessUnits } from "../../use-cases/list-business-units";
import { ListOperations } from "../../use-cases/list-operations";
import { ListSites } from "../../use-cases/list-sites";
import { RenameBusinessUnit } from "../../use-cases/rename-business-unit";
import { RenameOperation } from "../../use-cases/rename-operation";
import { RenameSite } from "../../use-cases/rename-site";
import { UpdateOperation } from "../../use-cases/update-operation";

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
  const assignments = new FakeAssignmentDirectory();
  const store = new InMemoryOrganizationStore(audit, assignments);
  const deps: OrganizationDeps = {
    unitOfWork: store.unitOfWork(),
    clock: new FixedClock(START),
    ids: new SequentialIdGenerator("id"),
    accessPolicy: new FakeAccessPolicy(),
  };
  const useCases = {
    createBusinessUnit: new CreateBusinessUnit(deps),
    createOperation: new CreateOperation(deps),
    createSite: new CreateSite(deps),
    renameBusinessUnit: new RenameBusinessUnit(deps),
    renameOperation: new RenameOperation(deps),
    renameSite: new RenameSite(deps),
    updateOperation: new UpdateOperation(deps),
    listBusinessUnits: new ListBusinessUnits(deps),
    listOperations: new ListOperations(deps),
    listSites: new ListSites(deps),
    archiveBusinessUnit: new ArchiveBusinessUnit(deps),
    archiveOperation: new ArchiveOperation(deps),
    archiveSite: new ArchiveSite(deps),
    restoreBusinessUnit: new RestoreBusinessUnit(deps),
    restoreOperation: new RestoreOperation(deps),
    restoreSite: new RestoreSite(deps),
  };

  const admin = actorWith([grant("admin", "tenant", "t-a")]);
  /** The only role that archives and restores (`catalog.archive`), at tenant scope. */
  const analyst = actorWith([grant("fleet_analyst", "tenant", "t-a")]);
  const analystB = actorWith([grant("fleet_analyst", "tenant", "t-b")], { tenantId: "t-b" });
  const orThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
    if (!result.ok) throw result.error;
    return result.value;
  };

  /**
   * Tenant A: Norte {Mina 1 at Taller (0001), Mina 2 at Patio (0002)}, Sur {Planta at Patio (0003)};
   * Lote has no operation. Mina 2 and Planta share the site Patio.
   */
  const seedTenantA = async () => {
    const north = orThrow(await useCases.createBusinessUnit.execute({ actor: admin, name: "Norte" }));
    const south = orThrow(await useCases.createBusinessUnit.execute({ actor: admin, name: "Sur" }));
    const site = async (name: string) => orThrow(await useCases.createSite.execute({ actor: admin, name }));
    const taller = await site("Taller");
    const patio = await site("Patio");
    const lote = await site("Lote");
    const op = async (businessUnitId: string, siteId: string, name: string, costCenter: string) =>
      orThrow(await useCases.createOperation.execute({ actor: admin, businessUnitId, siteId, name, costCenter }));
    const mina1 = await op(north.id, taller.id, "Mina 1", "0001");
    const mina2 = await op(north.id, patio.id, "Mina 2", "0002");
    const planta = await op(south.id, patio.id, "Planta", "0003");
    return { north, south, mina1, mina2, planta, taller, patio, lote };
  };

  const adminB = actorWith([grant("admin", "tenant", "t-b")], { tenantId: "t-b" });
  const auditOf = (action: string) => audit.entries.filter((entry) => entry.action === action);

  return { audit, store, assignments, deps, admin, adminB, analyst, analystB, auditOf, orThrow, seedTenantA, ...useCases };
};

export type Harness = ReturnType<typeof createHarness>;
