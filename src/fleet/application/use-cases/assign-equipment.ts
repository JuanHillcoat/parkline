import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import type { Result } from "../../../shared/domain/result";
import type { Assignment } from "../../domain/assignment";
import { assignAuthorized } from "../assign-in-tx";
import { authorizeTarget, type AssignmentTarget } from "../assignment-support";
import type { FleetDeps } from "../deps";
import { whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type AssignEquipmentInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  /** An operation (the equipment is active there) or a site (it is a spare of the site). */
  readonly target: AssignmentTarget;
  /** First day of the assignment, `YYYY-MM-DD`. */
  readonly day: string;
  /** Mandatory only when `day` is before today. */
  readonly reason?: string | null;
};

/**
 * Assigns an equipment to an operation, or as a spare to a site, from a day, open-ended. Needs
 * `catalog.write` at the position of the target, which is read through the shared directory (a missing one
 * answers like an unreachable one). An archived operation or site cannot receive it. A past start needs a reason; the days may never overlap another assignment of the equipment.
 * The rules after the authorization live in `assignAuthorized`, shared with `CreateEquipment`.
 */
export class AssignEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: AssignEquipmentInput): Promise<Result<Assignment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.assign(tx, input)));
  }

  private async assign(tx: FleetTx, input: AssignEquipmentInput): Promise<Result<Assignment, DomainError>> {
    const target = await authorizeTarget(tx, this.deps, input.actor, input.target);
    if (!target.ok) return target;
    return assignAuthorized(tx, this.deps, input.actor, input, target.value);
  }
}
