import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Role } from "../../domain/role";
import { requirePermission, type ActorContext } from "../actor-context";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { LastAdminError, SelfDeactivationError } from "../errors";
import { isLastActiveAdmin, requireReason } from "../guards";
import type { IdentityTx } from "../ports/identity-tx";

export type DeactivateUserInput = {
  readonly actor: ActorContext;
  readonly userId: string;
  readonly reason: string;
};

type Plan = {
  readonly actor: ActorContext;
  readonly actorRole: Role;
  readonly userId: string;
  readonly reason: string;
};

export class DeactivateUser {
  constructor(private readonly deps: IdentityDeps) {}

  execute(input: DeactivateUserInput): Promise<Result<void, DomainError>> {
    const plan = this.prepare(input);
    if (!plan.ok) return Promise.resolve(plan);
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan.value));
  }

  private prepare(input: DeactivateUserInput): Result<Plan, DomainError> {
    const { actor } = input;
    const actorRole = requirePermission(actor, "user.deactivate");
    if (!actorRole.ok) return actorRole;
    const reason = requireReason(input.reason);
    if (!reason.ok) return reason;
    const userId = input.userId.trim();
    if (userId === actor.user.id) return err(new SelfDeactivationError());
    return ok({ actor, actorRole: actorRole.value, userId, reason: reason.value });
  }

  /** Deactivation and session revocation commit together with the audit entry. */
  private async persist(tx: IdentityTx, plan: Plan): Promise<Result<void, DomainError>> {
    const { tenantId } = plan.actor.user;
    const target = await tx.users.findById(tenantId, plan.userId);
    if (target === null) return err(new NotFoundError("User", plan.userId));
    if (!target.active) return ok(undefined);
    if (await isLastActiveAdmin(tx, target)) return err(new LastAdminError());
    await tx.users.setActive(tenantId, target.id, false);
    await tx.sessions.revokeAllForUser(tenantId, target.id, this.deps.clock.now());
    await this.audit(tx, plan, target.id);
    return ok(undefined);
  }

  private audit(tx: IdentityTx, plan: Plan, userId: string): Promise<void> {
    return recordAudit(tx, this.deps, {
      actorId: plan.actor.user.id,
      actorKind: "user",
      actorRole: plan.actorRole,
      action: "user.deactivate",
      entityType: "user",
      entityId: userId,
      tenantId: plan.actor.user.tenantId,
      before: { active: true },
      after: { active: false },
      reason: plan.reason,
    });
  }
}
