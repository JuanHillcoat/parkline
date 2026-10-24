import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Assignment } from "../../domain/assignment";
import { positionOfAssignment } from "../assignment-support";
import type { FleetDeps } from "../deps";
import { canReadFleet, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";

export type ListEquipmentAssignmentsInput = { readonly actor: Actor; readonly equipmentId: string };

/**
 * The history of one equipment, newest first. Read-only, no audit entry. An actor holding `catalog.read`
 * tenant-wide sees every assignment and is told when the equipment does not exist; a scoped reader sees
 * only the assignments at positions it may read, and an unknown id answers the same empty list as an
 * equipment it cannot see.
 */
export class ListEquipmentAssignments {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ListEquipmentAssignmentsInput): Promise<Result<readonly Assignment[], DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.list(tx, input)));
  }

  private async list(tx: FleetTx, input: ListEquipmentAssignmentsInput): Promise<Result<readonly Assignment[], DomainError>> {
    const { actor, equipmentId } = input;
    const policy = this.deps.accessPolicy;
    const wide = canReadFleet(policy, actor);
    if (wide && (await tx.equipment.findById(actor.tenantId, equipmentId)) === null) {
      return err(new NotFoundError("Equipment", equipmentId));
    }
    const rows = await tx.assignments.listByEquipment(actor.tenantId, equipmentId);
    return ok(wide ? rows : rows.filter((row) => policy.check(actor, "catalog.read", positionOfAssignment(row)).ok));
  }
}
