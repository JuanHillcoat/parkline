import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { Equipment } from "../../domain/entities";
import type { FleetDeps } from "../deps";
import { canReadFleet, mayIncludeArchived, whenActive, withArchived } from "../guards";

export type ListEquipmentInput = {
  readonly actor: Actor;
  /** Honored only for an actor holding `catalog.archive`; otherwise ignored. */
  readonly includeArchived?: boolean;
};

/**
 * Read-only, no audit entry. Equipment has no operation yet (P0-08), so only a tenant-wide
 * `catalog.read` sees it; scoped readers get an empty list.
 */
export class ListEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ListEquipmentInput): Promise<Result<readonly Equipment[], DomainError>> {
    const { actor } = input;
    const policy = this.deps.accessPolicy;
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        if (!canReadFleet(policy, actor)) return ok([]);
        const rows = await tx.equipment.listByTenant(actor.tenantId);
        return ok(withArchived(rows, mayIncludeArchived(policy, actor, input.includeArchived)));
      }),
    );
  }
}
