import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { createBusinessUnit, type BusinessUnit } from "../../domain/entities";
import { nameKey } from "../../domain/name";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, nameTaken, requireFreeName, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type CreateBusinessUnitInput = {
  readonly actor: Actor;
  readonly name: string;
};

/** D5: creating a business unit needs `catalog.write` over the whole tenant. */
export class CreateBusinessUnit {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: CreateBusinessUnitInput): Promise<Result<BusinessUnit, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: OrganizationTx, input: CreateBusinessUnitInput): Promise<Result<BusinessUnit, DomainError>> {
    const { actor } = input;
    const role = this.deps.accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId });
    if (!role.ok) return role;
    const unit = createBusinessUnit({ id: this.deps.ids.next(), tenantId: actor.tenantId, name: input.name });
    if (!unit.ok) return unit;
    const free = requireFreeName(await tx.businessUnits.findByName(actor.tenantId, nameKey(unit.value.name)), unit.value.name);
    if (!free.ok) return free;
    if (!(await tx.businessUnits.add(unit.value))) return nameTaken(unit.value.name);
    await this.audit(tx, actor, role.value, unit.value);
    return ok(unit.value);
  }

  private audit(tx: OrganizationTx, actor: Actor, role: string, unit: BusinessUnit): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.business_unit.create",
      entityType: "business_unit",
      entityId: unit.id,
      businessUnitId: unit.id,
      after: { name: unit.name },
    });
  }
}
