import type { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { authorize, ForbiddenError } from "../domain/authorizer";
import { roleGrants, type Permission } from "../domain/permission";
import type { Role } from "../domain/role";
import type { RoleAssignment } from "../domain/role-assignment";
import { scopeCovers } from "../domain/scope";
import type { User } from "../domain/user";

/** The authenticated caller, as returned by `AuthenticateSession`. */
export type ActorContext = {
  readonly user: User;
  readonly assignments: readonly RoleAssignment[];
};

/**
 * Authorizes `permission` over the actor's own tenant and returns the role that
 * granted it, which goes into the audit entry as `actorRole`.
 */
export const requirePermission = (
  actor: ActorContext,
  permission: Permission,
): Result<Role, DomainError> => {
  const { user, assignments } = actor;
  const resource = { tenantId: user.tenantId };
  const allowed = authorize({ user, assignments, permission, resource });
  if (!allowed.ok) return allowed;
  const granting = assignments.find(
    (a) =>
      a.active &&
      a.userId === user.id &&
      roleGrants(a.role, permission) &&
      scopeCovers(a.scope, resource, user.tenantId),
  );
  return granting ? ok(granting.role) : err(new ForbiddenError(`Permission ${permission} is not granted`));
};
