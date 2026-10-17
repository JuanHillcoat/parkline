import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { BusinessUnit } from "../../domain/entities";
import { nameKey, parseName } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type RenameBusinessUnitInput = {
  readonly actor: Actor;
  readonly id: string;
  readonly name: string;
};

/** D5: needs `catalog.write` over the business unit. Renaming is how mistakes are fixed (D8). */
export class RenameBusinessUnit {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: RenameBusinessUnitInput): Promise<Result<BusinessUnit, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.rename(tx, input)));
  }

  private async rename(tx: OrganizationTx, input: RenameBusinessUnitInput): Promise<Result<BusinessUnit, DomainError>> {
    const { actor, id } = input;
    const unit = await tx.businessUnits.findById(actor.tenantId, id);
    if (unit === null) return err(new NotFoundError("Business unit", id));
    const role = this.deps.accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId, businessUnitId: id });
    if (!role.ok) return role;
    const name = parseName(input.name);
    if (!name.ok) return name;
    const free = requireFreeName(await tx.businessUnits.findByName(actor.tenantId, nameKey(name.value)), name.value, id);
    if (!free.ok) return free;
    await tx.businessUnits.rename(actor.tenantId, id, name.value);
    await this.audit(tx, actor, role.value, unit, name.value);
    return ok({ ...unit, name: name.value });
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, unit: BusinessUnit, name: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.rename",
      entityType: "business_unit",
      entityId: unit.id,
      businessUnitId: unit.id,
      before: { name: unit.name },
      after: { name },
    });
  }
}
