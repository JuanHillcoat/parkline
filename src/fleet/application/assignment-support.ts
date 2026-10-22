import { NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { Actor, ResourcePosition } from "../../shared/domain/ports/access-policy";
import type { OperationInfo } from "../../shared/domain/ports/operation-directory";
import { err, ok, type Result } from "../../shared/domain/result";
import { hasReason } from "../../shared/domain/sensitive-actions";
import { createAssignment, type Assignment } from "../domain/assignment";
import { compareDays, type Day } from "../domain/day";
import {
  AssignmentOverlapError,
  InvalidPeriodError,
  NoOpenAssignmentError,
  OperationArchivedError,
} from "../domain/errors";
import { overlapsAny } from "../domain/periods";
import { assignmentSnapshot, recordAudit } from "./audit";
import type { FleetDeps } from "./deps";
import { auditActor, missingRow } from "./guards";
import type { FleetTx } from "./ports/fleet-tx";
import { parseReason } from "./reason";

const WRITE = "catalog.write";

/** An operation that passed the write check, with the role that granted it. */
export type Target = { readonly op: OperationInfo; readonly role: string };

/** The open assignment of an equipment that passed the write check at its position. */
export type Source = { readonly open: Assignment; readonly role: string };

export const positionOfOperation = (tenantId: string, op: OperationInfo): ResourcePosition => ({
  tenantId,
  businessUnitId: op.businessUnitId,
  operationId: op.id,
  siteId: op.siteId,
});

export const positionOfAssignment = (assignment: Assignment): ResourcePosition => ({
  tenantId: assignment.tenantId,
  businessUnitId: assignment.businessUnitId,
  operationId: assignment.operationId,
  siteId: assignment.siteId,
});

/**
 * Reads the operation through the shared directory and checks `catalog.write` at its position. The
 * position needs the stored row, so a missing operation answers like an unreachable one (see `missingRow`).
 */
export const authorizeOperation = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  operationId: string,
): Promise<Result<Target, DomainError>> => {
  const op = await tx.operations.find(actor.tenantId, operationId);
  if (op === null) return missingRow(deps.accessPolicy, actor, WRITE, new NotFoundError("Operation", operationId));
  const role = deps.accessPolicy.check(actor, WRITE, positionOfOperation(actor.tenantId, op));
  return role.ok ? ok({ op, role: role.value }) : role;
};

/** Checks `catalog.write` at the position of a stored assignment (the source of a move, end or correction). */
export const authorizeAssignment = (deps: FleetDeps, actor: Actor, assignment: Assignment): Result<string, DomainError> =>
  deps.accessPolicy.check(actor, WRITE, positionOfAssignment(assignment));

/** The open assignment of the equipment, authorized for writing; a missing one answers like an unreachable one. */
export const authorizeOpen = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  equipmentId: string,
): Promise<Result<Source, DomainError>> => {
  const open = await tx.assignments.findOpen(actor.tenantId, equipmentId);
  if (open === null) {
    const none = new NoOpenAssignmentError(`Equipment ${equipmentId} has no open assignment`);
    return missingRow(deps.accessPolicy, actor, WRITE, none);
  }
  const role = authorizeAssignment(deps, actor, open);
  return role.ok ? ok({ open, role: role.value }) : role;
};

/** An archived operation (or one whose site or division is archived) cannot receive an assignment. */
export const requireActiveOperation = (op: OperationInfo): Result<OperationInfo, DomainError> =>
  op.archivedAt === null ? ok(op) : err(new OperationArchivedError(`Operation ${op.id} is archived`));

export const overlapConflict = (): Result<never, DomainError> =>
  err(new AssignmentOverlapError("The equipment already has an assignment in that period"));

/** Adds an assignment: the pre-check gives the typed error, the repository's constraint covers a race. */
export const addAssignment = async (tx: FleetTx, next: Assignment): Promise<Result<void, DomainError>> => {
  const stored = await tx.assignments.listByEquipment(next.tenantId, next.equipmentId);
  if (overlapsAny(next, stored)) return overlapConflict();
  return (await tx.assignments.add(next)) === "stored" ? ok(undefined) : overlapConflict();
};

/** Replaces an existing assignment, checking its new days against the other assignments of the equipment. */
export const saveAssignment = async (tx: FleetTx, next: Assignment): Promise<Result<void, DomainError>> => {
  const stored = await tx.assignments.listByEquipment(next.tenantId, next.equipmentId);
  if (overlapsAny(next, stored.filter((other) => other.id !== next.id))) return overlapConflict();
  return (await tx.assignments.update(next)) === "stored" ? ok(undefined) : overlapConflict();
};

/** The assignment closed on `validTo`; a closing day before its start is a typed error. */
export const closedOn = (open: Assignment, validTo: Day, reason: string): Result<Assignment, DomainError> =>
  compareDays(validTo, open.validFrom) < 0
    ? err(new InvalidPeriodError("The day must be after the start of the current assignment"))
    : ok({ ...open, validTo, reason });

/** What a new assignment needs besides the actor and the ports. */
export type NewAssignment = {
  readonly equipmentId: string;
  readonly op: OperationInfo;
  readonly kind: string;
  readonly day: Day;
  readonly reason: string | null;
};

/** An open assignment from `day`, with the division and site copied from the operation (D1). */
export const openAssignment = (deps: FleetDeps, actor: Actor, fields: NewAssignment): Result<Assignment, DomainError> =>
  createAssignment({
    id: deps.ids.next(),
    tenantId: actor.tenantId,
    equipmentId: fields.equipmentId,
    businessUnitId: fields.op.businessUnitId,
    operationId: fields.op.id,
    siteId: fields.op.siteId,
    kind: fields.kind,
    validFrom: fields.day,
    validTo: null,
    reason: fields.reason,
    createdBy: actor.userId,
    createdAt: deps.clock.now(),
  });

/** A first assignment needs a reason only when it starts before today; a given reason is kept either way. */
export const assignmentReason = (raw: string | null | undefined, day: Day, today: Day): Result<string | null, DomainError> => {
  if (compareDays(day, today) < 0) return parseReason(raw ?? "");
  return hasReason(raw) ? parseReason(raw ?? "") : ok(null);
};

export type AssignmentAudit = {
  readonly action: string;
  readonly actor: Actor;
  readonly role: string;
  /** The assignment the entry is about: it names the entity, the equipment and the position. */
  readonly subject: Assignment;
  readonly before?: Assignment;
  readonly after: unknown;
  readonly reason?: string | null;
};

/** Writes the audit entry of an assignment change; call it last, inside the unit of work. */
export const recordAssignmentAudit = (tx: FleetTx, deps: FleetDeps, entry: AssignmentAudit): Promise<void> => {
  const { subject } = entry;
  return recordAudit(tx, deps, {
    ...auditActor(entry.actor, entry.role),
    action: entry.action,
    entityType: "equipment_assignment",
    entityId: subject.id,
    subjectEquipmentId: subject.equipmentId,
    businessUnitId: subject.businessUnitId,
    operationId: subject.operationId,
    siteId: subject.siteId,
    before: entry.before === undefined ? undefined : assignmentSnapshot(entry.before),
    after: entry.after,
    reason: entry.reason ?? undefined,
  });
};
