import { ForbiddenError, type DomainError } from "../../shared/domain/domain-error";
import type {
  AccessPolicy,
  Actor,
  Grant,
  ResourcePosition,
} from "../../shared/domain/ports/access-policy";
import { err, type Result } from "../../shared/domain/result";
import { authorizeRole } from "../domain/authorizer";
import { PERMISSIONS, type Permission } from "../domain/permission";
import { parseRole } from "../domain/role";
import type { RoleAssignment } from "../domain/role-assignment";
import type { ScopeType } from "../domain/scope";

const SCOPE_TYPES: readonly string[] = ["tenant", "business_unit", "operation", "site"];

const isPermission = (value: string): value is Permission =>
  (PERMISSIONS as readonly string[]).includes(value);

const toAssignment = (actor: Actor, grant: Grant): RoleAssignment[] => {
  const role = parseRole(grant.role);
  if (!role.ok || !SCOPE_TYPES.includes(grant.scopeType)) return [];
  const scope = { type: grant.scopeType as ScopeType, id: grant.scopeId };
  return [{ userId: actor.userId, role: role.value, scope, active: true }];
};

/**
 * Identity's implementation of the shared `AccessPolicy`: the same `authorize`
 * rules as `requirePermission`, over the grants carried by the `Actor`.
 */
export class IdentityAccessPolicy implements AccessPolicy {
  check(actor: Actor, permission: string, resource: ResourcePosition): Result<string, DomainError> {
    if (!isPermission(permission)) return err(new ForbiddenError(`Unknown permission ${permission}`));
    return authorizeRole({
      user: { id: actor.userId, tenantId: actor.tenantId, active: actor.active },
      assignments: actor.grants.flatMap((grant) => toAssignment(actor, grant)),
      permission,
      resource,
    });
  }
}
