import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { parseAssignmentKind, type Assignment } from "../../domain/assignment";
import { parseDay, previousDay } from "../../domain/day";
import { SameOperationError } from "../../domain/errors";
import {
  addAssignment,
  authorizeOpen,
  authorizeOperation,
  closedOn,
  openAssignment,
  recordAssignmentAudit,
  requireActiveOperation,
  saveAssignment,
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
  /** The operation that receives the equipment; it must differ from the current one. */
  readonly operationId: string;
  /** First day in the new operation; the current assignment ends the day before. */
  readonly day: string;
  readonly reason: string;
  /** Defaults to the kind of the assignment being closed. */
  readonly kind?: string;
};

export type MoveOutcome = { readonly closed: Assignment; readonly opened: Assignment };

type Plan = { readonly closed: Assignment; readonly day: string; readonly kind: string; readonly reason: string };
type Context = { readonly input: MoveEquipmentInput; readonly target: Target; readonly source: Source; readonly plan: Plan };

/**
 * Closes the open assignment the day before `day` and opens a new one in another operation on `day`, in
 * one unit of work. Needs `catalog.write` at the target operation AND at the operation being left; the
 * reason is mandatory.
 */
export class MoveEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: MoveEquipmentInput): Promise<Result<MoveOutcome, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.move(tx, input)));
  }

  private async move(tx: FleetTx, input: MoveEquipmentInput): Promise<Result<MoveOutcome, DomainError>> {
    const target = await authorizeOperation(tx, this.deps, input.actor, input.operationId);
    if (!target.ok) return target;
    const source = await authorizeOpen(tx, this.deps, input.actor, input.equipmentId);
    if (!source.ok) return source;
    const plan = this.plan(input, source.value, target.value);
    return plan.ok ? this.apply(tx, { input, target: target.value, source: source.value, plan: plan.value }) : plan;
  }

  private plan(input: MoveEquipmentInput, source: Source, target: Target): Result<Plan, DomainError> {
    if (source.open.operationId === target.op.id) return err(new SameOperationError());
    const active = requireActiveOperation(target.op);
    if (!active.ok) return active;
    const kind = parseAssignmentKind(input.kind ?? source.open.kind);
    const day = parseDay(input.day);
    const reason = parseReason(input.reason);
    if (!kind.ok) return kind;
    if (!day.ok) return day;
    if (!reason.ok) return reason;
    const closed = closedOn(source.open, previousDay(day.value), reason.value);
    return closed.ok ? ok({ closed: closed.value, day: day.value, kind: kind.value, reason: reason.value }) : closed;
  }

  private async apply(tx: FleetTx, context: Context): Promise<Result<MoveOutcome, DomainError>> {
    const { input, target, plan } = context;
    const saved = await saveAssignment(tx, plan.closed);
    if (!saved.ok) return saved;
    const fields = { equipmentId: input.equipmentId, op: target.op, kind: plan.kind, day: plan.day, reason: plan.reason };
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
