import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import type { Assignment } from "../../domain/assignment";
import { parseDay } from "../../domain/day";
import { authorizeOpenLocked, closedOn, recordAssignmentAudit, saveAssignment, type Source } from "../assignment-support";
import { assignmentSnapshot } from "../audit";
import type { FleetDeps } from "../deps";
import { whenActive } from "../guards";
import type { FleetTx } from "../ports/fleet-tx";
import { parseReason } from "../reason";

export type EndAssignmentInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  /** Last day of the open assignment; it cannot be before the day it started. */
  readonly day: string;
  readonly reason: string;
};

/**
 * Closes the open assignment of an equipment on a day (inclusive); the equipment stays unassigned and
 * available. Needs `catalog.write` at the operation of that assignment and a mandatory reason.
 */
export class EndAssignment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: EndAssignmentInput): Promise<Result<Assignment, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.end(tx, input)));
  }

  private async end(tx: FleetTx, input: EndAssignmentInput): Promise<Result<Assignment, DomainError>> {
    const source = await authorizeOpenLocked(tx, this.deps, input.actor, input.equipmentId);
    if (!source.ok) return source;
    const closed = this.close(source.value, input);
    if (!closed.ok) return closed;
    const saved = await saveAssignment(tx, closed.value);
    if (!saved.ok) return saved;
    await this.audit(tx, input.actor, source.value, closed.value);
    return ok(closed.value);
  }

  private close(source: Source, input: EndAssignmentInput): Result<Assignment, DomainError> {
    const day = parseDay(input.day);
    if (!day.ok) return day;
    const reason = parseReason(input.reason);
    return reason.ok ? closedOn(source.open, day.value, reason.value) : reason;
  }

  private audit(tx: FleetTx, actor: Actor, source: Source, closed: Assignment): Promise<void> {
    return recordAssignmentAudit(tx, this.deps, {
      action: "fleet.assignment.end",
      actor,
      role: source.role,
      subject: closed,
      before: source.open,
      after: assignmentSnapshot(closed),
      reason: closed.reason,
    });
  }
}
