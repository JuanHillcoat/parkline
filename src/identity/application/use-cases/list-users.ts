import type { DomainError } from "../../../shared/domain/domain-error";
import { ok, type Result } from "../../../shared/domain/result";
import type { Role } from "../../domain/role";
import { requirePermission, type ActorContext } from "../actor-context";
import type { IdentityDeps } from "../deps";

export type ListUsersInput = {
  readonly actor: ActorContext;
};

/** What the users screen shows. It never carries a password hash. */
export type UserSummary = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly roles: readonly Role[];
};

/** Read-only: no audit entry. The repositories scope every query by tenant. */
export class ListUsers {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: ListUsersInput): Promise<Result<readonly UserSummary[], DomainError>> {
    const allowed = requirePermission(input.actor, "user.read");
    if (!allowed.ok) return allowed;
    const { tenantId } = input.actor.user;
    return this.deps.unitOfWork.run(async (tx) => {
      const users = await tx.users.listByTenant(tenantId);
      const assignments = await tx.assignments.listActiveByTenant(tenantId);
      return ok(
        users.map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          active: user.active,
          roles: assignments.filter((a) => a.userId === user.id).map((a) => a.role),
        })),
      );
    });
  }
}
