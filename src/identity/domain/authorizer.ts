import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { roleGrants, type Permission } from "./permission";
import type { RoleAssignment } from "./role-assignment";
import { scopeCovers, type ResourceScope } from "./scope";
import type { User } from "./user";

export class ForbiddenError extends DomainError {
  readonly code: string = "forbidden";
}

export class InactiveUserError extends DomainError {
  readonly code: string = "inactive_user";
}

export class TenantMismatchError extends DomainError {
  readonly code: string = "tenant_mismatch";
}

export type AuthorizationRequest = {
  readonly user: User;
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
 * distinguishable: inactive user, tenant mismatch, then missing grant.
 */
export const authorize = (request: AuthorizationRequest): Result<void, DomainError> => {
  const { user, resource, permission } = request;
  if (!user.active) return err(new InactiveUserError(`User ${user.id} is inactive`));
  if (user.tenantId !== resource.tenantId) {
    return err(new TenantMismatchError("User and resource belong to different tenants"));
  }
  if (request.assignments.some((assignment) => grants(request, assignment))) {
    return ok(undefined);
  }
  return err(new ForbiddenError(`Permission ${permission} is not granted for this resource`));
};
