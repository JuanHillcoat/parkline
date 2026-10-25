import { NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { Actor } from "../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../shared/domain/result";
import { parseAssignmentKind, type Assignment } from "../domain/assignment";
import { dayOf, parseDay, type Day } from "../domain/day";
import { OpenAssignmentError } from "../domain/errors";
import { addAssignment, assignmentReason, openAssignment, recordAssignmentAudit, requireActiveOperation, type Target } from "./assignment-support";
import { assignmentSnapshot } from "./audit";
import type { FleetDeps } from "./deps";
import { archivedRow } from "./guards";
import type { FleetTx } from "./ports/fleet-tx";

/** What a first assignment needs besides the actor: the equipment, the target operation and the raw form values. */
export type FirstAssignment = {
  readonly equipmentId: string;
  readonly kind: string;
  /** First day of the assignment, `YYYY-MM-DD`. */
  readonly day: string;
  /** Mandatory only when `day` is before today. */
  readonly reason?: string | null;
};

type Plan = { readonly kind: string; readonly day: Day; readonly reason: string | null };

const plan = (deps: FleetDeps, input: FirstAssignment): Result<Plan, DomainError> => {
  const kind = parseAssignmentKind(input.kind);
  if (!kind.ok) return kind;
  const day = parseDay(input.day);
  if (!day.ok) return day;
  const reason = assignmentReason(input.reason, day.value, dayOf(deps.clock.now()));
  return reason.ok ? ok({ kind: kind.value, day: day.value, reason: reason.value }) : reason;
};

/**
 * The equipment exists in the tenant, is active and has no open assignment. The row is locked FIRST, so
 * the archived state and the open assignment read afterwards are those a concurrent archive committed.
 */
const requireFreeEquipment = async (tx: FleetTx, tenantId: string, equipmentId: string): Promise<Result<void, DomainError>> => {
  await tx.equipment.lock(tenantId, [equipmentId]);
  const equipment = await tx.equipment.findById(tenantId, equipmentId);
  if (equipment === null) return err(new NotFoundError("Equipment", equipmentId));
  if (equipment.archivedAt !== null) return archivedRow("Equipment", equipment.id);
  const open = await tx.assignments.findOpen(tenantId, equipment.id);
  return open === null ? ok(undefined) : err(new OpenAssignmentError(`Equipment ${equipment.id} already has an open assignment`));
};

const auditCreated = (tx: FleetTx, deps: FleetDeps, actor: Actor, role: string, subject: Assignment): Promise<void> =>
  recordAssignmentAudit(tx, deps, {
    action: "fleet.assignment.create",
    actor,
    role,
    subject,
    after: assignmentSnapshot(subject),
    reason: subject.reason,
  });

/** An assignment stored in the transaction whose audit entry is still to be written (`record`). */
export type StagedAssignment = { readonly assignment: Assignment; readonly record: () => Promise<void> };

const store = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  fields: { readonly equipmentId: string; readonly target: Target; readonly plan: Plan },
): Promise<Result<StagedAssignment, DomainError>> => {
  const { equipmentId, target } = fields;
  const created = openAssignment(deps, actor, { equipmentId, op: target.op, ...fields.plan });
  if (!created.ok) return created;
  const stored = await addAssignment(tx, created.value);
  if (!stored.ok) return stored;
  return ok({ assignment: created.value, record: () => auditCreated(tx, deps, actor, target.role, created.value) });
};

/**
 * The part of an assignment that runs after the actor was authorized at the operation (`authorizeOperation`),
 * shared by `AssignEquipment` and `CreateEquipment`: validates the kind, the day and the reason, requires an
 * active operation and a free equipment, then stores the assignment in the caller's transaction. The audit
 * entry is written by `record`, which the caller calls last (an audit entry is never rolled back by the fakes).
 */
export const stageAssignment = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  input: FirstAssignment,
  target: Target,
): Promise<Result<StagedAssignment, DomainError>> => {
  const planned = plan(deps, input);
  if (!planned.ok) return planned;
  const active = requireActiveOperation(target.op);
  if (!active.ok) return active;
  const free = await requireFreeEquipment(tx, actor.tenantId, input.equipmentId);
  return free.ok ? store(tx, deps, actor, { equipmentId: input.equipmentId, target, plan: planned.value }) : free;
};

/** `stageAssignment` followed by its audit entry: the whole of `AssignEquipment` after the authorization. */
export const assignAuthorized = async (
  tx: FleetTx,
  deps: FleetDeps,
  actor: Actor,
  input: FirstAssignment,
  target: Target,
): Promise<Result<Assignment, DomainError>> => {
  const staged = await stageAssignment(tx, deps, actor, input, target);
  if (!staged.ok) return staged;
  await staged.value.record();
  return ok(staged.value.assignment);
};
