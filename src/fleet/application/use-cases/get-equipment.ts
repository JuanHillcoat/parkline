import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { withNames } from "../equipment-names";
import { findVisibleEquipment, type EquipmentListItem } from "../equipment-visibility";
import type { FleetDeps } from "../deps";
import { whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type GetEquipmentInput = { readonly actor: Actor; readonly id: string };

/**
 * One equipment for the detail page, under the same visibility rule as `ListEquipment` (D6 of P0-08): a
 * tenant-wide `catalog.read` sees any equipment of its tenant, archived and unassigned included; a scoped
 * reader only the equipment whose open assignment it covers. A missing id and an id the actor cannot see
 * answer the same `not_found`, so ids cannot be probed. Read-only, no audit entry.
 */
export class GetEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: GetEquipmentInput): Promise<Result<EquipmentListItem, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.get(tx, input)));
  }

  private async get(tx: FleetTx, { actor, id }: GetEquipmentInput): Promise<Result<EquipmentListItem, DomainError>> {
    const visible = await findVisibleEquipment(tx, this.deps.accessPolicy, actor, id);
    if (visible === null) return err(new NotFoundError("Equipment", id));
    const [item] = await withNames(tx, actor.tenantId, [visible]);
    // `withNames` returns one row per row it is given or throws: a missing item is an invariant violation,
    // not a "not found" the caller could be told about.
    if (item === undefined) throw new Error(`withNames returned no row for the visible equipment ${id}`);
    return ok(item);
  }
}
