import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { parseRole, type Role } from "../../domain/role";
import { createRoleAssignment, type RoleAssignment } from "../../domain/role-assignment";
import type { Scope } from "../../domain/scope";
import type { User } from "../../domain/user";
import { requirePermission, type ActorContext } from "../actor-context";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { LastAdminError, RoleUnchangedError, UserInactiveError } from "../errors";
import { isLastActiveAdmin, requireReason, rolesSnapshot } from "../guards";
import type { IdentityTx } from "../ports/identity-tx";
import { resolveScope, scopeNames, type RawScope, type ResolvedScope } from "../scope-rules";

export type ChangeUserRoleInput = {
  readonly actor: ActorContext;
  readonly userId: string;
  /** Raw value from the caller; validated against the role vocabulary. */
  readonly newRole: string;
  /** Where the role applies; defaults to the whole tenant. */
  readonly scope?: RawScope;
  readonly reason: string;
};

type Plan = {
  readonly actor: ActorContext;
  readonly actorRole: Role;
  readonly userId: string;
  readonly newRole: Role;
  readonly scope: ResolvedScope;
  readonly reason: string;
};

const sameScope = (a: Scope, b: Scope): boolean => a.type === b.type && a.id === b.id;

/**
 * Replaces ALL the user's active roles, whatever their scope, with one role over one scope, in one
 * transaction (decisions D3 and D4: one role and one scope per user).
 */
export class ChangeUserRole {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: ChangeUserRoleInput): Promise<Result<RoleAssignment, DomainError>> {
    const checked = this.check(input);
    if (!checked.ok) return checked;
    const { actor, actorRole, reason, newRole } = checked.value;
    const scope = await resolveScope(this.deps, actor.user.tenantId, newRole, input.scope);
    if (!scope.ok) return scope;
    const plan: Plan = { actor, actorRole, reason, newRole, scope: scope.value, userId: input.userId.trim() };
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan));
  }

  private check(input: ChangeUserRoleInput): Result<Omit<Plan, "scope" | "userId">, DomainError> {
    const actorRole = requirePermission(input.actor, "role.assign");
    if (!actorRole.ok) return actorRole;
    const reason = requireReason(input.reason);
    if (!reason.ok) return reason;
    const newRole = parseRole(input.newRole);
    if (!newRole.ok) return newRole;
    return ok({ actor: input.actor, actorRole: actorRole.value, newRole: newRole.value, reason: reason.value });
  }

  private async persist(tx: IdentityTx, plan: Plan): Promise<Result<RoleAssignment, DomainError>> {
    const { tenantId } = plan.actor.user;
    const target = await tx.users.findById(tenantId, plan.userId);
    if (target === null) return err(new NotFoundError("User", plan.userId));
    if (!target.active) return err(new UserInactiveError());
    const before = await tx.assignments.listActiveByUser(tenantId, target.id);
    const blocked = await this.rejection(tx, target, before, plan);
    if (blocked) return err(blocked);
    return this.replace(tx, plan, target, before);
  }

  private async rejection(
    tx: IdentityTx,
    target: User,
    current: readonly RoleAssignment[],
    plan: Plan,
  ): Promise<DomainError | null> {
    const [only] = current;
    if (current.length === 1 && only?.role === plan.newRole && sameScope(only.scope, plan.scope.scope)) {
      return new RoleUnchangedError();
    }
    if (plan.newRole === "admin") return null;
    return (await isLastActiveAdmin(tx, target)) ? new LastAdminError() : null;
  }

  private async replace(
    tx: IdentityTx,
    plan: Plan,
    target: User,
    before: readonly RoleAssignment[],
  ): Promise<Result<RoleAssignment, DomainError>> {
    const { tenantId } = plan.actor.user;
    const created = createRoleAssignment({ userId: target.id, role: plan.newRole, scope: plan.scope.scope });
    if (!created.ok) return created;
    for (const old of before) await tx.assignments.deactivate(tenantId, old);
    await tx.assignments.add(tenantId, created.value);
    await this.audit(tx, plan, target.id, { before, after: [created.value] });
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
      after: rolesSnapshot(change.after, scopeNames(plan.scope)),
      reason: plan.reason,
    });
  }
}
