import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Assignment } from "../../domain/assignment";
import { parseDay, previousDay } from "../../domain/day";
import { SameOperationError, SameSiteError } from "../../domain/errors";
import {
  addAssignment,
  authorizeOpenLocked,
  authorizeTarget,
  closedOn,
  isAt,
  openAssignment,
  recordAssignmentAudit,
  requireActiveTarget,
  saveAssignment,
  type AssignmentTarget,
  type Source,
  type Target,
} from "../assignment-support";
import { assignmentSnapshot } from "../audit";
import type { FleetDeps } from "../deps";
import { whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";

export type MoveEquipmentInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  /** Where the equipment goes: an operation (active) or a site (spare); it must differ from the current place. */
  readonly target: AssignmentTarget;
  /** First day in the new place; the current assignment ends the day before. */
  readonly day: string;
  readonly reason: string;
};

export type MoveOutcome = { readonly closed: Assignment; readonly opened: Assignment };

type Plan = { readonly closed: Assignment; readonly day: string; readonly reason: string };
type Context = { readonly input: MoveEquipmentInput; readonly target: Target; readonly source: Source; readonly plan: Plan };

/**
 * Closes the open assignment the day before `day` and opens a new one on `day`, in one unit of work, from an
 * operation to another operation or to a site (as a spare), and back. Needs `catalog.write` at the target AND
 * at the place being left; the reason is mandatory.
 */
export class MoveEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: MoveEquipmentInput): Promise<Result<MoveOutcome, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.move(tx, input)));
  }

  private async move(tx: FleetTx, input: MoveEquipmentInput): Promise<Result<MoveOutcome, DomainError>> {
    const target = await authorizeTarget(tx, this.deps, input.actor, input.target);
    if (!target.ok) return target;
    const source = await authorizeOpenLocked(tx, this.deps, input.actor, input.equipmentId);
    if (!source.ok) return source;
    const plan = this.plan(input, source.value, target.value);
    return plan.ok ? this.apply(tx, { input, target: target.value, source: source.value, plan: plan.value }) : plan;
  }

  private plan(input: MoveEquipmentInput, source: Source, target: Target): Result<Plan, DomainError> {
    if (isAt(source.open, input.target)) return err(target.kind === "active" ? new SameOperationError() : new SameSiteError());
    const active = requireActiveTarget(target);
    if (!active.ok) return active;
    const day = parseDay(input.day);
    const reason = parseReason(input.reason);
    if (!day.ok) return day;
    if (!reason.ok) return reason;
    const closed = closedOn(source.open, previousDay(day.value), reason.value);
    return closed.ok ? ok({ closed: closed.value, day: day.value, reason: reason.value }) : closed;
  }

  private async apply(tx: FleetTx, context: Context): Promise<Result<MoveOutcome, DomainError>> {
    const { input, target, plan } = context;
    const saved = await saveAssignment(tx, plan.closed);
    if (!saved.ok) return saved;
    const fields = { equipmentId: input.equipmentId, target, day: plan.day, reason: plan.reason };
    const opened = openAssignment(this.deps, input.actor, fields);
    if (!opened.ok) return opened;
    const added = await addAssignment(tx, opened.value);
    if (!added.ok) return added;
    await this.audit(tx, context, opened.value);
    return ok({ closed: plan.closed, opened: opened.value });
  }

  private audit(tx: FleetTx, context: Context, opened: Assignment): Promise<void> {
    return recordAssignmentAudit(tx, this.deps, {
      action: "fleet.assignment.move",
      actor: context.input.actor,
      role: context.target.role,
      subject: opened,
      before: context.source.open,
      after: assignmentSnapshot(opened),
      reason: context.plan.reason,
    });
  }
}
