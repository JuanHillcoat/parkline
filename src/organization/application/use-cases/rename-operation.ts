import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Operation } from "../../domain/entities";
import { nameKey, parseName } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, nameTaken, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type RenameOperationInput = {
  readonly actor: Actor;
  readonly id: string;
  readonly name: string;
};

/** D5: needs `catalog.write` over the operation or its business unit. Unique per unit (D7). */
export class RenameOperation {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: RenameOperationInput): Promise<Result<Operation, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.rename(tx, input)));
  }

  private async rename(tx: OrganizationTx, input: RenameOperationInput): Promise<Result<Operation, DomainError>> {
    const { actor, id } = input;
    const operation = await tx.operations.findById(actor.tenantId, id);
    if (operation === null) return err(new NotFoundError("Operation", id));
    const position = { tenantId: actor.tenantId, businessUnitId: operation.businessUnitId, operationId: id };
    const role = this.deps.accessPolicy.check(actor, "catalog.write", position);
    if (!role.ok) return role;
    const name = parseName(input.name);
    if (!name.ok) return name;
    const same = await tx.operations.findByName(actor.tenantId, operation.businessUnitId, nameKey(name.value));
    const free = requireFreeName(same, name.value, id);
    if (!free.ok) return free;
    if (!(await tx.operations.rename(actor.tenantId, id, name.value))) return nameTaken(name.value);
    await this.audit(tx, actor, role.value, operation, name.value);
    return ok({ ...operation, name: name.value });
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, operation: Operation, name: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.rename",
      entityType: "operation",
      entityId: operation.id,
      businessUnitId: operation.businessUnitId,
      operationId: operation.id,
      before: { name: operation.name },
      after: { name },
    });
  }
}
