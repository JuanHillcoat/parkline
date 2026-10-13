import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { parseRole, type Role } from "../../domain/role";
import { createRoleAssignment, type RoleAssignment } from "../../domain/role-assignment";
import type { User } from "../../domain/user";
import { requirePermission, type ActorContext } from "../actor-context";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { LastAdminError, RoleUnchangedError, UserInactiveError } from "../errors";
import { isLastActiveAdmin, requireReason, rolesSnapshot } from "../guards";
import type { IdentityTx } from "../ports/identity-tx";

export type ChangeUserRoleInput = {
  readonly actor: ActorContext;
  readonly userId: string;
  /** Raw value from the caller; validated against the role vocabulary. */
  readonly newRole: string;
  readonly reason: string;
};

type Plan = {
  readonly actor: ActorContext;
  readonly actorRole: Role;
  readonly userId: string;
  readonly newRole: Role;
  readonly reason: string;
};

/** Replaces the user's tenant-scoped roles with one role, in one transaction (decision D4). */
export class ChangeUserRole {
  constructor(private readonly deps: IdentityDeps) {}

  execute(input: ChangeUserRoleInput): Promise<Result<RoleAssignment, DomainError>> {
    const plan = this.prepare(input);
    if (!plan.ok) return Promise.resolve(plan);
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan.value));
  }

  private prepare(input: ChangeUserRoleInput): Result<Plan, DomainError> {
    const actorRole = requirePermission(input.actor, "role.assign");
    if (!actorRole.ok) return actorRole;
    const reason = requireReason(input.reason);
    if (!reason.ok) return reason;
    const newRole = parseRole(input.newRole);
    if (!newRole.ok) return newRole;
    const { actor } = input;
    return ok({
      actor,
      actorRole: actorRole.value,
      userId: input.userId.trim(),
      newRole: newRole.value,
      reason: reason.value,
    });
  }

  private async persist(tx: IdentityTx, plan: Plan): Promise<Result<RoleAssignment, DomainError>> {
    const { tenantId } = plan.actor.user;
    const target = await tx.users.findById(tenantId, plan.userId);
    if (target === null) return err(new NotFoundError("User", plan.userId));
    if (!target.active) return err(new UserInactiveError());
    const before = await tx.assignments.listActiveByUser(tenantId, target.id);
    const current = before.filter((a) => a.scope.type === "tenant");
    const blocked = await this.rejection(tx, target, current, plan.newRole);
    if (blocked) return err(blocked);
    return this.replace(tx, plan, target, { before, current });
  }

  private async rejection(
    tx: IdentityTx,
    target: User,
    current: readonly RoleAssignment[],
    newRole: Role,
  ): Promise<DomainError | null> {
    if (current.length === 1 && current[0]?.role === newRole) return new RoleUnchangedError();
    if (newRole === "admin") return null;
    return (await isLastActiveAdmin(tx, target)) ? new LastAdminError() : null;
  }

  private async replace(
    tx: IdentityTx,
    plan: Plan,
    target: User,
    roles: { before: readonly RoleAssignment[]; current: readonly RoleAssignment[] },
  ): Promise<Result<RoleAssignment, DomainError>> {
    const { tenantId } = plan.actor.user;
    const scope = { type: "tenant", id: tenantId } as const;
    const created = createRoleAssignment({ userId: target.id, role: plan.newRole, scope });
    if (!created.ok) return created;
    for (const old of roles.current) await tx.assignments.deactivate(tenantId, old);
    await tx.assignments.add(tenantId, created.value);
    const after = roles.before.filter((a) => !roles.current.includes(a));
    await this.audit(tx, plan, target.id, {
      before: roles.before,
      after: [...after, created.value],
    });
    return ok(created.value);
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
      action: "role.change",
      entityType: "user",
      entityId: userId,
      tenantId: plan.actor.user.tenantId,
      before: rolesSnapshot(change.before),
      after: rolesSnapshot(change.after),
      reason: plan.reason,
    });
  }
}
