import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import type { Result } from "../../../shared/domain/result";
import type { Assignment } from "../../domain/assignment";
import { assignAuthorized } from "../assign-in-tx";
import { authorizeOperation } from "../assignment-support";
import type { FleetDeps } from "../deps";
import { whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type AssignEquipmentInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  readonly operationId: string;
  /** `active` or `spare`. */
  readonly kind: string;
  /** First day of the assignment, `YYYY-MM-DD`. */
  readonly day: string;
  /** Mandatory only when `day` is before today. */
  readonly reason?: string | null;
};

/**
 * Assigns an equipment to an operation from a day, open-ended. Needs `catalog.write` at the position of
 * the operation, which is read through the shared directory (a missing one answers like an unreachable
 * one). A past start needs a reason; the days may never overlap another assignment of the equipment.
 * The rules after the authorization live in `assignAuthorized`, shared with `CreateEquipment`.
 */
export class AssignEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: AssignEquipmentInput): Promise<Result<Assignment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.assign(tx, input)));
  }

  private async assign(tx: FleetTx, input: AssignEquipmentInput): Promise<Result<Assignment, DomainError>> {
    const target = await authorizeOperation(tx, this.deps, input.actor, input.operationId);
    if (!target.ok) return target;
    return assignAuthorized(tx, this.deps, input.actor, input, target.value);
  }
}
