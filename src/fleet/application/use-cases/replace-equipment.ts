import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import type { OperationInfo } from "../../../shared/domain/ports/operation-directory";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Assignment } from "../../domain/assignment";
import { parseDay, previousDay, type Day } from "../../domain/day";
import { OpenAssignmentError, OutgoingChoiceRequiredError, SameEquipmentError } from "../../domain/errors";
import { equipmentSubject } from "../archive-subjects";
import { archiveWithin } from "../archiving";
import {
  addAssignment,
  authorizeOpen,
  closedOn,
  openAssignment,
  recordAssignmentAudit,
  requireActiveOperation,
  saveAssignment,
  type Source,
} from "../assignment-support";
import { assignmentSnapshot } from "../audit";
import type { FleetDeps } from "../deps";
import { archivedRow, authorize, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";

export type ReplaceEquipmentInput = {
  readonly actor: Actor;
  readonly incomingEquipmentId: string;
  /** The equipment being replaced; the incoming one takes its operation. */
  readonly outgoingEquipmentId: string;
  /** First day of the incoming equipment; the outgoing assignment ends the day before. */
  readonly day: string;
  /** `spare` or `retire`. Required: there is no default. */
  readonly outgoing?: string;
  readonly reason: string;
};

export type ReplaceOutcome = {
  readonly incoming: Assignment;
  /** The outgoing assignment as it ends: the closed one when retired, the new spare one otherwise. */
  readonly outgoing: Assignment;
  readonly retired: boolean;
};

type Choice = "spare" | "retire";
type Plan = { readonly choice: Choice; readonly day: Day; readonly reason: string; readonly closed: Assignment };
type Context = {
  readonly tx: FleetTx;
  readonly input: ReplaceEquipmentInput;
  readonly source: Source;
  readonly plan: Plan;
  readonly op: OperationInfo;
};

const parseChoice = (raw: string | undefined): Result<Choice, DomainError> =>
  raw === "spare" || raw === "retire" ? ok(raw) : err(new OutgoingChoiceRequiredError());

/**
 * The incoming equipment gets an `active` assignment in the operation of the outgoing one from `day`; the
 * outgoing equipment's open assignment is resolved in the same unit of work, by a required choice: it
 * becomes a `spare` assignment in the same operation, or it ends the day before and the equipment is
 * archived with the reason (that choice also needs `catalog.archive`, and reuses the archive engine).
 */
export class ReplaceEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ReplaceEquipmentInput): Promise<Result<ReplaceOutcome, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.replace(tx, input)));
  }

  private async replace(tx: FleetTx, input: ReplaceEquipmentInput): Promise<Result<ReplaceOutcome, DomainError>> {
    const source = await authorizeOpen(tx, this.deps, input.actor, input.outgoingEquipmentId);
    if (!source.ok) return source;
    const plan = this.plan(input, source.value);
    if (!plan.ok) return plan;
    const archive = plan.value.choice === "retire" ? authorize(this.deps.accessPolicy, input.actor, "catalog.archive") : ok("");
    if (!archive.ok) return archive;
    const op = await this.activeOperation(tx, input.actor, source.value.open.operationId);
    return op.ok ? this.apply({ tx, input, source: source.value, plan: plan.value, op: op.value }) : op;
  }

  private plan(input: ReplaceEquipmentInput, source: Source): Result<Plan, DomainError> {
    const choice = parseChoice(input.outgoing);
    const day = parseDay(input.day);
    const reason = parseReason(input.reason);
    if (!choice.ok) return choice;
    if (!day.ok) return day;
    if (!reason.ok) return reason;
    if (input.incomingEquipmentId === input.outgoingEquipmentId) return err(new SameEquipmentError());
    const closed = closedOn(source.open, previousDay(day.value), reason.value);
    return closed.ok ? ok({ choice: choice.value, day: day.value, reason: reason.value, closed: closed.value }) : closed;
  }

  private async activeOperation(tx: FleetTx, actor: Actor, operationId: string): Promise<Result<OperationInfo, DomainError>> {
    const op = await tx.operations.find(actor.tenantId, operationId);
    return op === null ? err(new NotFoundError("Operation", operationId)) : requireActiveOperation(op);
  }

  private async apply(context: Context): Promise<Result<ReplaceOutcome, DomainError>> {
    const incoming = await this.admitIncoming(context);
    if (!incoming.ok) return incoming;
    const outgoing = await this.resolveOutgoing(context);
    if (!outgoing.ok) return outgoing;
    const { choice } = context.plan;
    await this.audit(context, incoming.value, outgoing.value);
    return ok({ incoming: incoming.value, outgoing: outgoing.value, retired: choice === "retire" });
  }

  /** The incoming equipment must exist, be active and free from `day`; it gets an active assignment. */
  private async admitIncoming(context: Context): Promise<Result<Assignment, DomainError>> {
    const { tx, input, plan, op } = context;
    const { tenantId } = input.actor;
    const equipment = await tx.equipment.findById(tenantId, input.incomingEquipmentId);
    if (equipment === null) return err(new NotFoundError("Equipment", input.incomingEquipmentId));
    if (equipment.archivedAt !== null) return archivedRow("Equipment", equipment.id);
    if ((await tx.assignments.findOpen(tenantId, equipment.id)) !== null) {
      return err(new OpenAssignmentError(`Equipment ${equipment.id} already has an open assignment`));
    }
    const fields = { equipmentId: equipment.id, op, kind: "active", day: plan.day, reason: plan.reason };
    const created = openAssignment(this.deps, input.actor, fields);
    if (!created.ok) return created;
    const added = await addAssignment(tx, created.value);
    return added.ok ? ok(created.value) : added;
  }

  /** Closes the outgoing assignment the day before, then keeps it as a spare or archives the equipment. */
  private async resolveOutgoing(context: Context): Promise<Result<Assignment, DomainError>> {
    const { tx, input, plan, op } = context;
    const saved = await saveAssignment(tx, plan.closed);
    if (!saved.ok) return saved;
    if (plan.choice === "retire") return this.retire(context);
    const fields = { equipmentId: input.outgoingEquipmentId, op, kind: "spare", day: plan.day, reason: plan.reason };
    const spare = openAssignment(this.deps, input.actor, fields);
    if (!spare.ok) return spare;
    const added = await addAssignment(tx, spare.value);
    return added.ok ? ok(spare.value) : added;
  }

  private async retire(context: Context): Promise<Result<Assignment, DomainError>> {
    const { tx, input, plan } = context;
    const archive = { actor: input.actor, id: input.outgoingEquipmentId, reason: plan.reason };
    const archived = await archiveWithin(this.deps, equipmentSubject, "archive", archive, tx);
    return archived.ok ? ok(plan.closed) : archived;
  }

  private audit(context: Context, incoming: Assignment, outgoing: Assignment): Promise<void> {
    const { tx, input, source, plan } = context;
    return recordAssignmentAudit(tx, this.deps, {
      action: "fleet.assignment.replace",
      actor: input.actor,
      role: source.role,
      subject: incoming,
      before: source.open,
      after: { choice: plan.choice, incoming: assignmentSnapshot(incoming), outgoing: assignmentSnapshot(outgoing) },
      reason: plan.reason,
    });
  }
}
