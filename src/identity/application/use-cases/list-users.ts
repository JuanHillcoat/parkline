import type { DomainError } from "../../../shared/domain/domain-error";
import { scopeKey, type ScopeLabel } from "../../../shared/domain/ports/scope-directory";
import { ok, type Result } from "../../../shared/domain/result";
import type { Role } from "../../domain/role";
import type { RoleAssignment } from "../../domain/role-assignment";
import { requirePermission, type ActorContext } from "../actor-context";
import type { IdentityDeps } from "../deps";

export type ListUsersInput = {
  readonly actor: ActorContext;
};

/** One active role of a user with the scope it covers; `scopeLabel` is null for the tenant scope. */
export type UserGrant = {
  readonly role: Role;
  readonly scopeType: string;
  readonly scopeId: string;
  readonly scopeLabel: ScopeLabel | null;
};

/** What the users screen shows. It never carries a password hash. */
export type UserSummary = {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly active: boolean;
  readonly roles: readonly Role[];
  readonly grants: readonly UserGrant[];
};

const grantOf =
  (labels: ReadonlyMap<string, ScopeLabel>) =>
  ({ role, scope }: RoleAssignment): UserGrant => ({
    role,
    scopeType: scope.type,
    scopeId: scope.id,
    scopeLabel: labels.get(scopeKey(scope.type, scope.id)) ?? null,
  });

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
      // One lookup for every user, never one per user.
      const labels = await this.deps.scopes.labels(tenantId, assignments.map((a) => a.scope));
      return ok(
        users.map((user) => {
          const own = assignments.filter((a) => a.userId === user.id);
          const { id, email, displayName, active } = user;
          return { id, email, displayName, active, roles: own.map((a) => a.role), grants: own.map(grantOf(labels)) };
        }),
      );
    });
  }
}
