import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Role } from "../../domain/role";
import { createRoleAssignment, type RoleAssignment } from "../../domain/role-assignment";
import type { Scope } from "../../domain/scope";
import { TenantMismatchError } from "../../domain/authorizer";
import { requirePermission, type ActorContext } from "../actor-context";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { LastAdminError, ScopeNotAssignableYetError } from "../errors";
import { isLastActiveAdmin, requireReason, rolesSnapshot, sameGrant } from "../guards";
import type { IdentityTx } from "../ports/identity-tx";

export type RevokeRoleInput = {
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
  readonly target: RoleAssignment;
};

export class RevokeRole {
  constructor(private readonly deps: IdentityDeps) {}

  execute(input: RevokeRoleInput): Promise<Result<void, DomainError>> {
    const plan = this.prepare(input);
    if (!plan.ok) return Promise.resolve(plan);
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan.value));
  }

  private prepare(input: RevokeRoleInput): Result<Plan, DomainError> {
    const actorRole = requirePermission(input.actor, "role.assign");
    if (!actorRole.ok) return actorRole;
    const reason = requireReason(input.reason);
    if (!reason.ok) return reason;
    const { userId, role, scope } = input;
    if (scope.type !== "tenant") return err(new ScopeNotAssignableYetError(scope.type));
    const target = createRoleAssignment({ userId, role, scope });
    if (!target.ok) return target;
    if (target.value.scope.id !== input.actor.user.tenantId) {
      return err(new TenantMismatchError("The scope belongs to another tenant"));
    }
    return ok({ actor: input.actor, actorRole: actorRole.value, reason: reason.value, target: target.value });
  }

  private async persist(tx: IdentityTx, plan: Plan): Promise<Result<void, DomainError>> {
    const { tenantId } = plan.actor.user;
    const user = await tx.users.findById(tenantId, plan.target.userId);
    if (user === null) return err(new NotFoundError("User", plan.target.userId));
    const before = await tx.assignments.listActiveByUser(tenantId, user.id);
    const match = before.find((existing) => sameGrant(existing, plan.target));
    if (match === undefined) return err(new NotFoundError("Role assignment", user.id));
    if (match.role === "admin" && (await isLastActiveAdmin(tx, user))) return err(new LastAdminError());
    await tx.assignments.deactivate(tenantId, match);
    const after = before.filter((existing) => existing !== match);
    await this.audit(tx, plan, user.id, { before, after });
    return ok(undefined);
  }

  private audit(
    tx: IdentityTx,
    plan: Plan,
    userId: string,
    change: { before: readonly RoleAssignment[]; after: readonly RoleAssignment[] },
  ): Promise<void> {
    return recordAudit(tx, this.deps, {
      actorId: plan.actor.user.id,
      actorKind: "user",
      actorRole: plan.actorRole,
      action: "role.revoke",
      entityType: "user",
      entityId: userId,
      tenantId: plan.actor.user.tenantId,
      before: rolesSnapshot(change.before),
      after: rolesSnapshot(change.after),
      reason: plan.reason,
    });
  }
}
