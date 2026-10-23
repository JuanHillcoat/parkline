import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { parseAssignmentKind, type Assignment } from "../../domain/assignment";
import { dayOf, parseDay, type Day } from "../../domain/day";
import { OpenAssignmentError } from "../../domain/errors";
import {
  addAssignment,
  assignmentReason,
  authorizeOperation,
  openAssignment,
  recordAssignmentAudit,
  requireActiveOperation,
  type Target,
} from "../assignment-support";
import { assignmentSnapshot } from "../audit";
import type { FleetDeps } from "../deps";
import { archivedRow, whenActive } from "../guards";
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

type Plan = { readonly kind: string; readonly day: Day; readonly reason: string | null };

/**
 * Assigns an equipment to an operation from a day, open-ended. Needs `catalog.write` at the position of
 * the operation, which is read through the shared directory (a missing one answers like an unreachable
 * one). A past start needs a reason; the days may never overlap another assignment of the equipment.
 */
export class AssignEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: AssignEquipmentInput): Promise<Result<Assignment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.assign(tx, input)));
  }

  private async assign(tx: FleetTx, input: AssignEquipmentInput): Promise<Result<Assignment, DomainError>> {
    const target = await authorizeOperation(tx, this.deps, input.actor, input.operationId);
    if (!target.ok) return target;
    const plan = this.plan(input);
    if (!plan.ok) return plan;
    const active = requireActiveOperation(target.value.op);
    if (!active.ok) return active;
    const free = await this.requireFreeEquipment(tx, input);
    return free.ok ? this.store(tx, input, target.value, plan.value) : free;
  }

  private plan(input: AssignEquipmentInput): Result<Plan, DomainError> {
    const kind = parseAssignmentKind(input.kind);
    if (!kind.ok) return kind;
    const day = parseDay(input.day);
    if (!day.ok) return day;
    const reason = assignmentReason(input.reason, day.value, dayOf(this.deps.clock.now()));
    return reason.ok ? ok({ kind: kind.value, day: day.value, reason: reason.value }) : reason;
  }

  /**
   * The equipment exists in the tenant, is active and has no open assignment. The row is locked FIRST, so
   * the archived state and the open assignment read afterwards are those a concurrent archive committed.
   */
  private async requireFreeEquipment(tx: FleetTx, input: AssignEquipmentInput): Promise<Result<void, DomainError>> {
    const { tenantId } = input.actor;
    await tx.equipment.lock(tenantId, [input.equipmentId]);
    const equipment = await tx.equipment.findById(tenantId, input.equipmentId);
    if (equipment === null) return err(new NotFoundError("Equipment", input.equipmentId));
    if (equipment.archivedAt !== null) return archivedRow("Equipment", equipment.id);
    const open = await tx.assignments.findOpen(tenantId, equipment.id);
    return open === null ? ok(undefined) : err(new OpenAssignmentError(`Equipment ${equipment.id} already has an open assignment`));
  }

  private async store(tx: FleetTx, input: AssignEquipmentInput, target: Target, plan: Plan): Promise<Result<Assignment, DomainError>> {
    const { actor } = input;
    const created = openAssignment(this.deps, actor, { equipmentId: input.equipmentId, op: target.op, ...plan });
    if (!created.ok) return created;
    const stored = await addAssignment(tx, created.value);
    if (!stored.ok) return stored;
    await recordAssignmentAudit(tx, this.deps, {
      action: "fleet.assignment.create",
      actor,
      role: target.role,
      subject: created.value,
      after: assignmentSnapshot(created.value),
      reason: created.value.reason,
    });
    return ok(created.value);
  }
}
