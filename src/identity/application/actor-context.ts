import type { DomainError } from "../../shared/domain/domain-error";
import type { Result } from "../../shared/domain/result";
import { authorizeRole } from "../domain/authorizer";
import type { Permission } from "../domain/permission";
import type { Role } from "../domain/role";
import type { RoleAssignment } from "../domain/role-assignment";
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
): Result<Role, DomainError> =>
  authorizeRole({
    user: actor.user,
    assignments: actor.assignments,
    permission,
    resource: { tenantId: actor.user.tenantId },
  });
