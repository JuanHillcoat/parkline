import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import { createSupplier, type Supplier } from "../../domain/entities";
import { recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { auditActor, authorize, nameTaken, requireFreeName, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type CreateSupplierInput = {
  readonly actor: Actor;
  readonly name: string;
};

/** Creating a supplier needs `catalog.write` over the whole tenant. The name is unique among active rows. */
export class CreateSupplier {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: CreateSupplierInput): Promise<Result<Supplier, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.create(tx, input)));
  }

  private async create(tx: FleetTx, input: CreateSupplierInput): Promise<Result<Supplier, DomainError>> {
    const { actor } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const supplier = createSupplier({ id: this.deps.ids.next(), tenantId: actor.tenantId, name: input.name });
    if (!supplier.ok) return supplier;
    const free = requireFreeName(await tx.suppliers.findByName(actor.tenantId, nameKey(supplier.value.name)), supplier.value.name);
    if (!free.ok) return free;
    if (!(await tx.suppliers.add(supplier.value))) return nameTaken(supplier.value.name);
    await this.audit(tx, actor, role.value, supplier.value);
    return ok(supplier.value);
  }

  private audit(tx: FleetTx, actor: Actor, role: string, supplier: Supplier): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.supplier.create",
      entityType: "supplier",
      entityId: supplier.id,
      after: { name: supplier.name },
    });
  }
}
