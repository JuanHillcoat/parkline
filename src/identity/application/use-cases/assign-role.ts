import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { TenantMismatchError } from "../../domain/authorizer";
import type { Role } from "../../domain/role";
import { createRoleAssignment, type RoleAssignment } from "../../domain/role-assignment";
import type { Scope } from "../../domain/scope";
import { requirePermission, type ActorContext } from "../actor-context";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { RoleAssignmentExistsError, ScopeNotAssignableYetError } from "../errors";
import { requireReason, rolesSnapshot, sameGrant } from "../guards";
import type { IdentityTx } from "../ports/identity-tx";

export type AssignRoleInput = {
  readonly actor: ActorContext;
  readonly userId: string;
  readonly role: Role;
  readonly scope: Scope;
  readonly reason: string;
};

type Plan = {
  readonly actor: ActorContext;
  readonly actorRole: Role;
  readonly reason: string;
  readonly assignment: RoleAssignment;
};

/** Only the tenant scope is assignable until the catalog modules exist (decision D4). */
export class AssignRole {
  constructor(private readonly deps: IdentityDeps) {}

  execute(input: AssignRoleInput): Promise<Result<RoleAssignment, DomainError>> {
    const plan = this.prepare(input);
    if (!plan.ok) return Promise.resolve(plan);
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan.value));
  }

  private prepare(input: AssignRoleInput): Result<Plan, DomainError> {
    const { actor, scope } = input;
    const actorRole = requirePermission(actor, "role.assign");
    if (!actorRole.ok) return actorRole;
    const reason = requireReason(input.reason);
    if (!reason.ok) return reason;
    if (scope.type !== "tenant") return err(new ScopeNotAssignableYetError(scope.type));
    const assignment = createRoleAssignment({ userId: input.userId, role: input.role, scope });
    if (!assignment.ok) return assignment;
    if (assignment.value.scope.id !== actor.user.tenantId) {
      return err(new TenantMismatchError("The scope belongs to another tenant"));
    }
    return ok({ actor, actorRole: actorRole.value, reason: reason.value, assignment: assignment.value });
  }

  private async persist(tx: IdentityTx, plan: Plan): Promise<Result<RoleAssignment, DomainError>> {
    const { tenantId } = plan.actor.user;
    const { assignment } = plan;
    const target = await tx.users.findById(tenantId, assignment.userId);
    if (target === null) return err(new NotFoundError("User", assignment.userId));
    const before = await tx.assignments.listActiveByUser(tenantId, target.id);
    if (before.some((existing) => sameGrant(existing, assignment))) {
      return err(new RoleAssignmentExistsError());
    }
    await tx.assignments.add(tenantId, assignment);
    await this.audit(tx, plan, target.id, before);
    return ok(assignment);
  }

  private audit(
    tx: IdentityTx,
    plan: Plan,
    targetId: string,
    before: readonly RoleAssignment[],
  ): Promise<void> {
    return recordAudit(tx, this.deps, {
      actorId: plan.actor.user.id,
      actorKind: "user",
      actorRole: plan.actorRole,
      action: "role.assign",
      entityType: "user",
      entityId: targetId,
      tenantId: plan.actor.user.tenantId,
      before: rolesSnapshot(before),
      after: rolesSnapshot([...before, plan.assignment]),
      reason: plan.reason,
    });
  }
}
