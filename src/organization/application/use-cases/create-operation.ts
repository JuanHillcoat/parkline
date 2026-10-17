import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { createOperation, type Operation } from "../../domain/entities";
import { nameKey } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type CreateOperationInput = {
  readonly actor: Actor;
  readonly businessUnitId: string;
  readonly name: string;
};

/** D5: needs `catalog.write` over the business unit the operation is created under. */
export class CreateOperation {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: CreateOperationInput): Promise<Result<Operation, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: OrganizationTx, input: CreateOperationInput): Promise<Result<Operation, DomainError>> {
    const { actor, businessUnitId } = input;
    const unit = await tx.businessUnits.findById(actor.tenantId, businessUnitId);
    if (unit === null) return err(new NotFoundError("Business unit", businessUnitId));
    const role = this.deps.accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId, businessUnitId });
    if (!role.ok) return role;
    const created = createOperation({ id: this.deps.ids.next(), tenantId: actor.tenantId, businessUnitId, name: input.name });
    if (!created.ok) return created;
    const taken = await tx.operations.findByName(actor.tenantId, businessUnitId, nameKey(created.value.name));
    const free = requireFreeName(taken, created.value.name);
    if (!free.ok) return free;
    await tx.operations.add(created.value);
    await this.audit(tx, actor, role.value, created.value);
    return ok(created.value);
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, operation: Operation): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.operation.create",
      entityType: "operation",
      entityId: operation.id,
      businessUnitId: operation.businessUnitId,
      operationId: operation.id,
      after: { name: operation.name, businessUnitId: operation.businessUnitId },
    });
  }
}
