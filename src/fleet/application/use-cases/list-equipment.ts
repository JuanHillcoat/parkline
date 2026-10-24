import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { withNames } from "../equipment-names";
import { visibleEquipment, type EquipmentListItem } from "../equipment-visibility";
import type { FleetDeps } from "../deps";
import { mayIncludeArchived, whenActive, withArchived } from "../guards";

export type ListEquipmentInput = {
  readonly actor: Actor;
  /** Honored only for an actor holding `catalog.archive`; otherwise ignored. */
  readonly includeArchived?: boolean;
};

/**
 * Read-only, no audit entry. Visibility follows the open assignment (D6 of P0-08): a tenant-wide
 * `catalog.read` sees every equipment, a scoped reader sees the equipment placed inside its scope and
 * nothing else. Each row carries its current assignment summary (or null) and the names of its supplier and
 * asset type, which a scoped reader could not read from the catalogs.
 */
export class ListEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ListEquipmentInput): Promise<Result<readonly EquipmentListItem[], DomainError>> {
    const { actor } = input;
    const policy = this.deps.accessPolicy;
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const all = await tx.equipment.listByTenant(actor.tenantId);
        const rows = withArchived(all, mayIncludeArchived(policy, actor, input.includeArchived));
        const open = await tx.assignments.listOpen(actor.tenantId);
        return ok(await withNames(tx, actor.tenantId, visibleEquipment(policy, actor, rows, open)));
      }),
    );
  }
}
