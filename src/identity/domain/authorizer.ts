import { DomainError, ForbiddenError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { roleGrants, type Permission } from "./permission";
import type { Role } from "./role";
import type { RoleAssignment } from "./role-assignment";
import { scopeCovers, type ResourceScope } from "./scope";
import type { User } from "./user";

// Same class as the shared kernel's, re-exported so identity code keeps its import path.
export { ForbiddenError };

export class InactiveUserError extends DomainError {
  readonly code: string = "inactive_user";
}

export class TenantMismatchError extends DomainError {
  readonly code: string = "tenant_mismatch";
}

export type AuthorizationRequest = {
  /** Only the identity facts the policy reads; a full `User` satisfies it. */
  readonly user: Pick<User, "id" | "tenantId" | "active">;
  readonly assignments: readonly RoleAssignment[];
  readonly permission: Permission;
  readonly resource: ResourceScope;
};

const grants = (request: AuthorizationRequest, assignment: RoleAssignment): boolean =>
  assignment.active &&
  assignment.userId === request.user.id &&
  roleGrants(assignment.role, request.permission) &&
  scopeCovers(assignment.scope, request.resource, request.user.tenantId);

/**
 * Role x scope policy. Checks run in a fixed order so each denial reason is
 * distinguishable: inactive user, tenant mismatch, then missing grant. Returns
 * the role that granted the permission.
 */
export const authorizeRole = (request: AuthorizationRequest): Result<Role, DomainError> => {
  const { user, resource, permission } = request;
  if (!user.active) return err(new InactiveUserError(`User ${user.id} is inactive`));
  if (user.tenantId !== resource.tenantId) {
    return err(new TenantMismatchError("User and resource belong to different tenants"));
  }
  const granting = request.assignments.find((assignment) => grants(request, assignment));
  if (granting) return ok(granting.role);
  return err(new ForbiddenError(`Permission ${permission} is not granted for this resource`));
};

export const authorize = (request: AuthorizationRequest): Result<void, DomainError> => {
  const result = authorizeRole(request);
  return result.ok ? ok(undefined) : result;
};
