import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { createAssignment, type Assignment } from "../../domain/assignment";
import { NoChangesError } from "../../domain/errors";
import {
  authorizeAssignment,
  authorizeOperation,
  recordAssignmentAudit,
  requireActiveOperation,
  saveAssignment,
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
  readonly operationId?: string;
  readonly kind?: string;
};

type Place = Pick<Assignment, "businessUnitId" | "operationId" | "siteId">;

const unchanged = (a: Assignment, b: Assignment): boolean =>
  a.operationId === b.operationId && a.kind === b.kind && a.validFrom === b.validFrom && a.validTo === b.validTo;

/**
 * Changes the days, the operation or the kind of an existing assignment, keeping the no-overlap rule.
 * Needs `catalog.write` at the operation the assignment is in and, when it changes, at the new one; the
 * reason is mandatory. The audit entry stores the row before and after. Nothing is deleted.
 */
export class CorrectAssignment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: CorrectAssignmentInput): Promise<Result<Assignment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.correct(tx, input)));
  }

  private async correct(tx: FleetTx, input: CorrectAssignmentInput): Promise<Result<Assignment, DomainError>> {
    const { actor } = input;
    const current = await tx.assignments.findById(actor.tenantId, input.assignmentId);
    if (current === null) return this.missing(input);
    const role = authorizeAssignment(this.deps, actor, current);
    if (!role.ok) return role;
    const place = await this.place(tx, input, current);
    if (!place.ok) return place;
    const next = this.build(input, current, place.value);
    return next.ok ? this.apply(tx, { actor, role: role.value, current, next: next.value }) : next;
  }

  private missing(input: CorrectAssignmentInput): Result<never, DomainError> {
    const error = new NotFoundError("Assignment", input.assignmentId);
    return missingRow(this.deps.accessPolicy, input.actor, "catalog.write", error);
  }

  /**
   * The place the assignment ends up in. A closed assignment that keeps its operation is history and may
   * be corrected even if the operation was archived later; one that moves or ends up open must be in an
   * authorized and active operation, so a reopening cannot put an equipment in an archived one.
   */
  private async place(tx: FleetTx, input: CorrectAssignmentInput, current: Assignment): Promise<Result<Place, DomainError>> {
    const sameOperation = input.operationId === undefined || input.operationId === current.operationId;
    const opensIt = (input.validTo === undefined ? current.validTo : input.validTo) === null;
    if (sameOperation && !opensIt) return ok(current);
    const target = await authorizeOperation(tx, this.deps, input.actor, input.operationId ?? current.operationId);
    if (!target.ok) return target;
    const active = requireActiveOperation(target.value.op);
    const { op } = target.value;
    return active.ok ? ok({ businessUnitId: op.businessUnitId, operationId: op.id, siteId: op.siteId }) : active;
  }

  private build(input: CorrectAssignmentInput, current: Assignment, place: Place): Result<Assignment, DomainError> {
    const reason = parseReason(input.reason);
    if (!reason.ok) return reason;
    const next = createAssignment({
      ...current,
      ...place,
      kind: input.kind ?? current.kind,
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
