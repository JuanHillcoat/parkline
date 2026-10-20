import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { Supplier } from "../../domain/entities";
import type { FleetDeps } from "../deps";
import { canReadFleet, mayIncludeArchived, whenActive, withArchived } from "../guards";

export type ListSuppliersInput = {
  readonly actor: Actor;
  /** Honored only for an actor holding `catalog.archive`; otherwise ignored. */
  readonly includeArchived?: boolean;
};

/**
 * Read-only, no audit entry. Fleet rows sit at the tenant, so only a tenant-wide `catalog.read`
 * sees them for now (scoped readers get an empty list); active rows unless archived ones are allowed.
 */
export class ListSuppliers {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ListSuppliersInput): Promise<Result<readonly Supplier[], DomainError>> {
    const { actor } = input;
    const policy = this.deps.accessPolicy;
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        if (!canReadFleet(policy, actor)) return ok([]);
        const rows = await tx.suppliers.listByTenant(actor.tenantId);
        return ok(withArchived(rows, mayIncludeArchived(policy, actor, input.includeArchived)));
      }),
    );
  }
}
