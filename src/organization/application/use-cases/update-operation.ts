import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor, ResourcePosition } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { parseCostCenter } from "../../domain/cost-center";
import type { Operation } from "../../domain/entities";
import { NoChangesError } from "../../domain/errors";
import { nameKey, parseName } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { archivedRow, auditActor, costCenterTaken, lockParents, nameTaken, parentArchived, requireFreeName, whenActive } from "../guards";
import { parseReason } from "../reason";
import type { OperationUpdate } from "../ports/repositories";
import type { OrganizationTx } from "../ports/organization-tx";

export type UpdateOperationInput = {
  readonly actor: Actor;
  readonly operationId: string;
  /** The complete desired values: the form sends every field, prefilled with the current ones. */
  readonly name: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly costCenter: string;
  /** Mandatory: moving an operation or changing its cost center affects visibility and accounting. */
  readonly reason: string;
};

type Plan = {
  readonly actor: Actor;
  readonly role: string;
  readonly current: Operation;
  readonly next: Operation;
  readonly reason: string;
};

type Valid = { readonly name: string; readonly costCenter: string; readonly reason: string };

const divisionPosition = (actor: Actor, businessUnitId: string): ResourcePosition => ({
  tenantId: actor.tenantId,
  businessUnitId,
});

const snapshot = (operation: Operation) => ({
  name: operation.name,
  businessUnitId: operation.businessUnitId,
  siteId: operation.siteId,
  costCenter: operation.costCenter,
});

const unchanged = (a: Operation, b: Operation): boolean =>
  a.name === b.name && a.businessUnitId === b.businessUnitId && a.siteId === b.siteId && a.costCenter === b.costCenter;

/** The unique index rejected the write (a concurrent writer won): the same typed conflicts as creating. */
const conflictOf = (stored: OperationUpdate, next: Operation): Result<void, DomainError> => {
  if (stored === "name_taken") return nameTaken(next.name);
  return stored === "cost_center_taken" ? costCenterTaken(next.costCenter) : ok(undefined);
};

/**
 * Edits name, division, site and cost center of an operation, with a mandatory reason
 * and an audit entry holding the previous and the new values (sensitive action, ADR-0004).
 * D5: needs `catalog.write` at the position of the CURRENT division and, when the division
 * changes, also at the position of the TARGET division. The operation id and the site are
 * left out on purpose, so operation- and site-scoped writers cannot edit or move operations.
 */
export class UpdateOperation {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: UpdateOperationInput): Promise<Result<Operation, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.update(tx, input)));
  }

  private async update(tx: OrganizationTx, input: UpdateOperationInput): Promise<Result<Operation, DomainError>> {
    const { actor } = input;
    const current = await tx.operations.findById(actor.tenantId, input.operationId);
    if (current === null) return err(new NotFoundError("Operation", input.operationId));
    const role = this.deps.accessPolicy.check(actor, "catalog.write", divisionPosition(actor, current.businessUnitId));
    if (!role.ok) return role;
    if (current.archivedAt !== null) return archivedRow("Operation", current.id);
    const valid = this.validate(input);
    if (!valid.ok) return valid;
    const moved = await this.authorizeTarget(tx, input, current);
    if (!moved.ok) return moved;
    const { name, costCenter, reason } = valid.value;
    const next = { ...current, name, costCenter, businessUnitId: input.businessUnitId, siteId: input.siteId };
    return this.apply(tx, { actor, role: role.value, current, next, reason });
  }

  private validate(input: UpdateOperationInput): Result<Valid, DomainError> {
    const reason = parseReason(input.reason);
    if (!reason.ok) return reason;
    const name = parseName(input.name);
    if (!name.ok) return name;
    const costCenter = parseCostCenter(input.costCenter);
    if (!costCenter.ok) return costCenter;
    return ok({ name: name.value, costCenter: costCenter.value, reason: reason.value });
  }

  /** The target division and site must exist in the tenant; a different division needs write there too. */
  private async authorizeTarget(tx: OrganizationTx, input: UpdateOperationInput, current: Operation): Promise<Result<void, DomainError>> {
    const { actor, businessUnitId, siteId } = input;
    await lockParents(tx, actor.tenantId, businessUnitId, siteId);
    const unit =await tx.businessUnits.findById(actor.tenantId, businessUnitId);
    if (unit === null) return err(new NotFoundError("Business unit", businessUnitId));
    const site = await tx.sites.findById(actor.tenantId, siteId);
    if (site === null) return err(new NotFoundError("Site", siteId));
    if (unit.archivedAt !== null || site.archivedAt !== null) return parentArchived();
    if (businessUnitId === current.businessUnitId) return ok(undefined);
    const target = this.deps.accessPolicy.check(actor, "catalog.write", divisionPosition(actor, businessUnitId));
    return target.ok ? ok(undefined) : target;
  }

  private async apply(tx: OrganizationTx, plan: Plan): Promise<Result<Operation, DomainError>> {
    const { current, next } = plan;
    if (unchanged(current, next)) return err(new NoChangesError());
    const free = await this.requireFree(tx, next);
    if (!free.ok) return free;
    const stored = conflictOf(await tx.operations.update(next), next);
    if (!stored.ok) return stored;
    await this.audit(tx, plan);
    return ok(next);
  }

  /** Friendly pre-check, ignoring the operation itself; the unique indexes stay the safety net. */
  private async requireFree(tx: OrganizationTx, next: Operation): Promise<Result<void, DomainError>> {
    const sameName = await tx.operations.findByName(next.tenantId, next.businessUnitId, nameKey(next.name));
    const free = requireFreeName(sameName, next.name, next.id);
    if (!free.ok) return free;
    const sameCode = await tx.operations.findByCostCenter(next.tenantId, next.costCenter);
    return sameCode === null || sameCode.id === next.id ? ok(undefined) : costCenterTaken(next.costCenter);
  }

  private audit(tx: OrganizationTx, plan: Plan): Promise<void> {
    const { actor, role, current, next, reason } = plan;
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.operation.update",
      entityType: "operation",
      entityId: next.id,
      businessUnitId: next.businessUnitId,
      operationId: next.id,
      siteId: next.siteId,
      before: snapshot(current),
      after: snapshot(next),
      reason,
    });
  }
}
