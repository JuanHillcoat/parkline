import { NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { Actor, ResourcePosition } from "../../shared/domain/ports/access-policy";
import type { OperationInfo, SiteInfo } from "../../shared/domain/ports/operation-directory";
import { err, ok, type Result } from "../../shared/domain/result";
import { hasReason } from "../../shared/domain/sensitive-actions";
import { createAssignment, type Assignment } from "../domain/assignment";
import { compareDays, type Day } from "../domain/day";
import {
  AssignmentOverlapError,
  InvalidPeriodError,
  NoOpenAssignmentError,
  OperationArchivedError,
  SiteArchivedError,
} from "../domain/errors";
import { overlapsAny } from "../domain/periods";
import { assignmentSnapshot, recordAudit } from "./audit";
import type { FleetDeps } from "./deps";
import { auditActor, missingRow } from "./guards";
import type { FleetTx } from "./ports/fleet-tx";
import { parseReason } from "./reason";

const WRITE = "catalog.write";

/** Where an assignment goes, as a caller names it: an operation (active) or a site (spare). */
export type AssignmentTarget = { readonly operationId: string } | { readonly siteId: string };

/**
 * A target that passed the write check, with the role that granted it: an operation (kind `active`) or a
 * site (kind `spare`, ADR-0013). The kind is derived from it.
 */
export type Target =
  | { readonly kind: "active"; readonly op: OperationInfo; readonly role: string }
  | { readonly kind: "spare"; readonly site: SiteInfo; readonly role: string };

/** The open assignment of an equipment that passed the write check at its position. */
export type Source = { readonly open: Assignment; readonly role: string };

export const positionOfOperation = (tenantId: string, op: OperationInfo): ResourcePosition => ({
  tenantId,
  businessUnitId: op.businessUnitId,
  operationId: op.id,
  siteId: op.siteId,
});

/**
 * The position of a spare at a site: the tenant and the site, no division and no operation (ADR-0013). Only
 * a grant that covers the whole company (or the site itself) matches it.
 */
export const positionOfSite = (tenantId: string, siteId: string): ResourcePosition => ({ tenantId, siteId });

export const positionOfAssignment = (assignment: Assignment): ResourcePosition =>
  assignment.operationId === null || assignment.businessUnitId === null
    ? positionOfSite(assignment.tenantId, assignment.siteId)
    : {
        tenantId: assignment.tenantId,
        businessUnitId: assignment.businessUnitId,
        operationId: assignment.operationId,
        siteId: assignment.siteId,
      };

export const positionOfTarget = (tenantId: string, target: Target): ResourcePosition =>
  target.kind === "active" ? positionOfOperation(tenantId, target.op) : positionOfSite(tenantId, target.site.id);

/** Division, operation and site an assignment stores for a target (operation and division null for a site). */
export const placeOf = (target: Target): Pick<Assignment, "businessUnitId" | "operationId" | "siteId"> =>
  target.kind === "active"
    ? { businessUnitId: target.op.businessUnitId, operationId: target.op.id, siteId: target.op.siteId }
    : { businessUnitId: null, operationId: null, siteId: target.site.id };

/** Whether the assignment already is where the target says (same operation and kind, or the same site as a spare). */
export const isAt = (assignment: Assignment, target: AssignmentTarget): boolean =>
  "operationId" in target
    ? assignment.kind === "active" && assignment.operationId === target.operationId
    : assignment.operationId === null && assignment.siteId === target.siteId;

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
  return role.ok ? ok({ kind: "active", op, role: role.value }) : role;
};

/**
 * Reads the site through the shared directory and checks `catalog.write` at the position of a site spare.
 * A missing site answers like an unreachable one, as a missing operation does.
 */
export const authorizeSite = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  siteId: string,
): Promise<Result<Target, DomainError>> => {
  const site = await tx.operations.findSite(actor.tenantId, siteId);
  if (site === null) return missingRow(deps.accessPolicy, actor, WRITE, new NotFoundError("Site", siteId));
  const role = deps.accessPolicy.check(actor, WRITE, positionOfSite(actor.tenantId, site.id));
  return role.ok ? ok({ kind: "spare", site, role: role.value }) : role;
};

/** `authorizeOperation` or `authorizeSite`, by what the target names. */
export const authorizeTarget = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  target: AssignmentTarget,
): Promise<Result<Target, DomainError>> =>
  "operationId" in target ? authorizeOperation(tx, deps, actor, target.operationId) : authorizeSite(tx, deps, actor, target.siteId);

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

/**
 * `authorizeOpen` under the equipment row lock: authorize first (a refused actor never waits on a lock and
 * learns nothing from contention), lock the equipment, then read the open assignment again so the decision
 * is made on what concurrent writers committed. The same rule as assign, archive and replace.
 */
export const authorizeOpenLocked = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  equipmentId: string,
): Promise<Result<Source, DomainError>> => {
  const first = await authorizeOpen(tx, deps, actor, equipmentId);
  if (!first.ok) return first;
  await tx.equipment.lock(actor.tenantId, [equipmentId]);
  return authorizeOpen(tx, deps, actor, equipmentId);
};

/** An archived operation (or one whose site or division is archived) cannot receive an assignment. */
export const requireActiveOperation = (op: OperationInfo): Result<OperationInfo, DomainError> =>
  op.archivedAt === null ? ok(op) : err(new OperationArchivedError(`Operation ${op.id} is archived`));

/** The target can receive an assignment: an active operation, or a site that is not archived. */
export const requireActiveTarget = (target: Target): Result<Target, DomainError> => {
  if (target.kind === "active") {
    const active = requireActiveOperation(target.op);
    return active.ok ? ok(target) : active;
  }
  return target.site.archivedAt === null ? ok(target) : err(new SiteArchivedError(`Site ${target.site.id} is archived`));
};

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
  readonly target: Target;
  readonly day: Day;
  readonly reason: string | null;
};

/**
 * An open assignment from `day`. Its kind comes from the target; for an operation the division and site are
 * copied from it (D1), for a site the operation and division stay null.
 */
export const openAssignment = (deps: FleetDeps, actor: Actor, fields: NewAssignment): Result<Assignment, DomainError> =>
  createAssignment({
    id: deps.ids.next(),
    tenantId: actor.tenantId,
    equipmentId: fields.equipmentId,
    ...placeOf(fields.target),
    kind: fields.target.kind,
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
    businessUnitId: subject.businessUnitId ?? undefined,
    operationId: subject.operationId ?? undefined,
    siteId: subject.siteId,
    before: entry.before === undefined ? undefined : assignmentSnapshot(entry.before),
    after: entry.after,
    reason: entry.reason ?? undefined,
  });
};
