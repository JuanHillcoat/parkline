import type { Actor, Grant } from "../../../../shared/domain/ports/access-policy";
import { FixedClock } from "../../../../shared/infrastructure/fixed-clock";
import { InMemoryAuditLog } from "../../../../shared/infrastructure/in-memory-audit-log";
import { SequentialIdGenerator } from "../../../../shared/infrastructure/sequential-id-generator";
import { InMemoryOrganizationStore } from "../../../infrastructure/in-memory-organization-store";
import { FakeAccessPolicy } from "../../../__tests__/support/fake-access-policy";
import type { OrganizationDeps } from "../../deps";
import { CreateBusinessUnit } from "../../use-cases/create-business-unit";
import { CreateOperation } from "../../use-cases/create-operation";
import { CreateSite } from "../../use-cases/create-site";
import { LinkOperationSite } from "../../use-cases/link-operation-site";
import { ListBusinessUnits } from "../../use-cases/list-business-units";
import { ListOperations } from "../../use-cases/list-operations";
import { ListSites } from "../../use-cases/list-sites";
import { RenameBusinessUnit } from "../../use-cases/rename-business-unit";
import { RenameOperation } from "../../use-cases/rename-operation";
import { RenameSite } from "../../use-cases/rename-site";

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
  const store = new InMemoryOrganizationStore(audit);
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
    link: new LinkOperationSite(deps),
    listBusinessUnits: new ListBusinessUnits(deps),
    listOperations: new ListOperations(deps),
    listSites: new ListSites(deps),
  };

  const admin = actorWith([grant("admin", "tenant", "t-a")]);
  const orThrow = <T>(result: { ok: true; value: T } | { ok: false; error: Error }): T => {
    if (!result.ok) throw result.error;
    return result.value;
  };

  /** Tenant A: bu-n {Mina 1, Mina 2}, bu-s {Planta}; sites Taller (Mina 1), Patio (Mina 2 and Planta), Lote (unlinked). */
  const seedTenantA = async () => {
    const north = orThrow(await useCases.createBusinessUnit.execute({ actor: admin, name: "Norte" }));
    const south = orThrow(await useCases.createBusinessUnit.execute({ actor: admin, name: "Sur" }));
    const op = async (businessUnitId: string, name: string) =>
      orThrow(await useCases.createOperation.execute({ actor: admin, businessUnitId, name }));
    const mina1 = await op(north.id, "Mina 1");
    const mina2 = await op(north.id, "Mina 2");
    const planta = await op(south.id, "Planta");
    const site = async (name: string) => orThrow(await useCases.createSite.execute({ actor: admin, name }));
    const taller = await site("Taller");
    const patio = await site("Patio");
    const lote = await site("Lote");
    const link = async (operationId: string, siteId: string) =>
      orThrow(await useCases.link.execute({ actor: admin, operationId, siteId }));
    await link(mina1.id, taller.id);
    await link(mina2.id, patio.id);
    await link(planta.id, patio.id);
    return { north, south, mina1, mina2, planta, taller, patio, lote };
  };

  const adminB = actorWith([grant("admin", "tenant", "t-b")], { tenantId: "t-b" });
  const auditOf = (action: string) => audit.entries.filter((entry) => entry.action === action);

  return { audit, store, deps, admin, adminB, auditOf, orThrow, seedTenantA, ...useCases };
};

export type Harness = ReturnType<typeof createHarness>;
