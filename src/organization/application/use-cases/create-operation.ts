import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { createOperation, type Operation } from "../../domain/entities";
import { ParentArchivedError } from "../../domain/errors";
import { nameKey } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, costCenterTaken, lockParents, nameTaken, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type CreateOperationInput = {
  readonly actor: Actor;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly name: string;
  readonly costCenter: string;
};

/**
 * D5: needs `catalog.write` at the position `{tenant, businessUnit}`, so a tenant
 * or division scope can create. The operation id and the site are left out on
 * purpose: a write grant at site scope (or at another operation) is not enough.
 * The division and the site must exist in the actor's tenant (otherwise not found).
 */
export class CreateOperation {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: CreateOperationInput): Promise<Result<Operation, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: OrganizationTx, input: CreateOperationInput): Promise<Result<Operation, DomainError>> {
    const { actor, businessUnitId, siteId, name, costCenter } = input;
    const missing = await this.findMissingParent(tx, input);
    if (missing !== null) return err(missing);
    const role = this.deps.accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId, businessUnitId });
    if (!role.ok) return role;
    const created = createOperation({ id: this.deps.ids.next(), tenantId: actor.tenantId, businessUnitId, siteId, name, costCenter });
    if (!created.ok) return created;
    const stored = await this.store(tx, created.value);
    if (!stored.ok) return stored;
    await this.audit(tx, actor, role.value, created.value);
    return ok(created.value);
  }

  /** A missing division or site is not found; an archived one is a conflict (D4). */
  private async findMissingParent(tx: OrganizationTx, input: CreateOperationInput): Promise<DomainError | null> {
    const { actor, businessUnitId, siteId } = input;
    await lockParents(tx, actor.tenantId, businessUnitId, siteId);
    const unit =await tx.businessUnits.findById(actor.tenantId, businessUnitId);
    if (unit === null) return new NotFoundError("Business unit", businessUnitId);
    const site = await tx.sites.findById(actor.tenantId, siteId);
    if (site === null) return new NotFoundError("Site", siteId);
    return unit.archivedAt !== null || site.archivedAt !== null ? new ParentArchivedError("The division or the site is archived") : null;
  }

  private async store(tx: OrganizationTx, operation: Operation): Promise<Result<void, DomainError>> {
    const free = await this.requireFree(tx, operation);
    if (!free.ok) return free;
    const added = await tx.operations.add(operation);
    if (added === "name_taken") return nameTaken(operation.name);
    return added === "cost_center_taken" ? costCenterTaken(operation.costCenter) : ok(undefined);
  }

  /** Friendly pre-check; the unique indexes stay the safety net for concurrent writers. */
  private async requireFree(tx: OrganizationTx, operation: Operation): Promise<Result<void, DomainError>> {
    const sameName = await tx.operations.findByName(operation.tenantId, operation.businessUnitId, nameKey(operation.name));
    const free = requireFreeName(sameName, operation.name);
    if (!free.ok) return free;
    const sameCode = await tx.operations.findByCostCenter(operation.tenantId, operation.costCenter);
    return sameCode === null ? ok(undefined) : costCenterTaken(operation.costCenter);
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, operation: Operation): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.operation.create",
      entityType: "operation",
      entityId: operation.id,
      businessUnitId: operation.businessUnitId,
      operationId: operation.id,
      siteId: operation.siteId,
      after: {
        name: operation.name,
        businessUnitId: operation.businessUnitId,
        siteId: operation.siteId,
        costCenter: operation.costCenter,
      },
    });
  }
}
