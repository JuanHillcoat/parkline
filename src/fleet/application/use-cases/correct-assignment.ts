import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { createAssignment, type Assignment, type AssignmentKind } from "../../domain/assignment";
import { NoChangesError } from "../../domain/errors";
import {
  authorizeAssignment,
  authorizeTarget,
  isAt,
  placeOf,
  recordAssignmentAudit,
  requireActiveTarget,
  saveAssignment,
  type AssignmentTarget,
} from "../assignment-support";
import { assignmentSnapshot } from "../audit";
import type { FleetDeps } from "../deps";
import { missingRow, whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";

export type CorrectAssignmentInput = {
  readonly actor: Actor;
  readonly assignmentId: string;
  readonly reason: string;
  /** Fields left undefined keep their value; `validTo: null` makes the assignment open. */
  readonly validFrom?: string;
  readonly validTo?: string | null;
  /** An operation (active) or a site (spare); left undefined it keeps the place and the kind. */
  readonly target?: AssignmentTarget;
};

type Place = Pick<Assignment, "businessUnitId" | "operationId" | "siteId"> & { readonly kind: AssignmentKind };

const unchanged = (a: Assignment, b: Assignment): boolean =>
  a.operationId === b.operationId && a.siteId === b.siteId && a.kind === b.kind && a.validFrom === b.validFrom && a.validTo === b.validTo;

/**
 * Changes the days or the target (an operation, or a site as a spare; the kind follows the target) of an
 * existing assignment, keeping the no-overlap rule. Needs `catalog.write` at the place the assignment is in
 * and, when it changes, at the new one; the
 * reason is mandatory. The audit entry stores the row before and after. Nothing is deleted.
 */
export class CorrectAssignment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: CorrectAssignmentInput): Promise<Result<Assignment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.correct(tx, input)));
  }

  private async correct(tx: FleetTx, input: CorrectAssignmentInput): Promise<Result<Assignment, DomainError>> {
    const { actor } = input;
    const found = await this.readLocked(tx, input);
    if (!found.ok) return found;
    const { current, role } = found.value;
    const place = await this.place(tx, input, current);
    if (!place.ok) return place;
    const next = this.build(input, current, place.value);
    return next.ok ? this.apply(tx, { actor, role, current, next: next.value }) : next;
  }

  /**
   * Reads the assignment, authorizes, locks its equipment and reads it again, so the correction is decided
   * on committed data (authorization first: a refused actor never waits on a lock).
   */
  private async readLocked(tx: FleetTx, input: CorrectAssignmentInput): Promise<Result<{ current: Assignment; role: string }, DomainError>> {
    const { actor, assignmentId } = input;
    const first = await tx.assignments.findById(actor.tenantId, assignmentId);
    if (first === null) return this.missing(input);
    const allowed = authorizeAssignment(this.deps, actor, first);
    if (!allowed.ok) return allowed;
    await tx.equipment.lock(actor.tenantId, [first.equipmentId]);
    const current = await tx.assignments.findById(actor.tenantId, assignmentId);
    if (current === null) return this.missing(input);
    const role = authorizeAssignment(this.deps, actor, current);
    return role.ok ? ok({ current, role: role.value }) : role;
  }

  private missing(input: CorrectAssignmentInput): Result<never, DomainError> {
    const error = new NotFoundError("Assignment", input.assignmentId);
    return missingRow(this.deps.accessPolicy, input.actor, "catalog.write", error);
  }

  /**
   * The place the assignment ends up in. A closed assignment that keeps its target is history and may be
   * corrected even if the operation or site was archived later; one that moves or ends up open must be in an
   * authorized and active target, so a reopening cannot put an equipment in an archived one.
   */
  private async place(tx: FleetTx, input: CorrectAssignmentInput, current: Assignment): Promise<Result<Place, DomainError>> {
    const sameTarget = input.target === undefined || isAt(current, input.target);
    const opensIt = (input.validTo === undefined ? current.validTo : input.validTo) === null;
    if (sameTarget && !opensIt) return ok(current);
    const wanted = input.target ?? (current.operationId === null ? { siteId: current.siteId } : { operationId: current.operationId });
    const target = await authorizeTarget(tx, this.deps, input.actor, wanted);
    if (!target.ok) return target;
    const active = requireActiveTarget(target.value);
    // Without a target the kind stays (a spare stored inside an operation before ADR-0013 keeps being a spare).
    const kind = input.target === undefined ? current.kind : target.value.kind;
    return active.ok ? ok({ ...placeOf(target.value), kind }) : active;
  }

  private build(input: CorrectAssignmentInput, current: Assignment, place: Place): Result<Assignment, DomainError> {
    const reason = parseReason(input.reason);
    if (!reason.ok) return reason;
    const next = createAssignment({
      ...current,
      ...place,
      validFrom: input.validFrom ?? current.validFrom,
      validTo: input.validTo === undefined ? current.validTo : input.validTo,
      reason: reason.value,
    });
    return next.ok && unchanged(current, next.value) ? err(new NoChangesError()) : next;
  }

  private async apply(
    tx: FleetTx,
    change: { readonly actor: Actor; readonly role: string; readonly current: Assignment; readonly next: Assignment },
  ): Promise<Result<Assignment, DomainError>> {
    const { actor, role, current, next } = change;
    const saved = await saveAssignment(tx, next);
    if (!saved.ok) return saved;
    await recordAssignmentAudit(tx, this.deps, {
      action: "fleet.assignment.correct",
      actor,
      role,
      subject: next,
      before: current,
      after: assignmentSnapshot(next),
      reason: next.reason,
    });
    return ok(next);
  }
}
