import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { nameKey } from "../../../shared/domain/catalog-name";
import type { Supplier } from "../../domain/entities";
import { parseName } from "../../domain/values";
import { recordAudit } from "../audit";
import type { FleetDeps } from "../deps";
import { archivedRow, auditActor, authorize, nameTaken, requireFreeName, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type RenameSupplierInput = {
  readonly actor: Actor;
  readonly id: string;
  readonly name: string;
};

/** The quick typo fix: needs `catalog.write` over the tenant and no reason. Unique among active rows. */
export class RenameSupplier {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: RenameSupplierInput): Promise<Result<Supplier, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.rename(tx, input)));
  }

  private async rename(tx: FleetTx, input: RenameSupplierInput): Promise<Result<Supplier, DomainError>> {
    const { actor, id } = input;
    const role = authorize(this.deps.accessPolicy, actor, "catalog.write");
    if (!role.ok) return role;
    const supplier = await tx.suppliers.findById(actor.tenantId, id);
    if (supplier === null) return err(new NotFoundError("Supplier", id));
    if (supplier.archivedAt !== null) return archivedRow("Supplier", id);
    const name = parseName(input.name);
    if (!name.ok) return name;
    const free = requireFreeName(await tx.suppliers.findByName(actor.tenantId, nameKey(name.value)), name.value, id);
    if (!free.ok) return free;
    if (!(await tx.suppliers.rename(actor.tenantId, id, name.value))) return nameTaken(name.value);
    await this.audit(tx, actor, role.value, supplier, name.value);
    return ok({ ...supplier, name: name.value });
  }

  private audit(tx: FleetTx, actor: Actor, role: string, supplier: Supplier, name: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "fleet.supplier.rename",
      entityType: "supplier",
      entityId: supplier.id,
      before: { name: supplier.name },
      after: { name },
    });
  }
}
