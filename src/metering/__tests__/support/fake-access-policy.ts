import { ForbiddenError, type DomainError } from "../../../shared/domain/domain-error";
import type { AccessPolicy, Actor, Grant, ResourcePosition } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";

const ROLES_BY_PERMISSION: Readonly<Record<string, readonly string[]>> = {
  "catalog.read": ["admin", "manager", "fleet_analyst", "supervisor", "viewer"],
  "reading.write": ["admin", "fleet_analyst"],
  "reading.correct": ["admin", "fleet_analyst"],
};

const idAt = (scopeType: string, position: ResourcePosition): string | undefined => {
  if (scopeType === "tenant") return position.tenantId;
  if (scopeType === "business_unit") return position.businessUnitId;
  if (scopeType === "operation") return position.operationId;
  if (scopeType === "site") return position.siteId;
  return undefined;
};

const grantsPermission = (grant: Grant, permission: string): boolean =>
  ROLES_BY_PERMISSION[permission]?.includes(grant.role) ?? false;

/**
 * Test double with the same contract as the shared `AccessPolicy`: a grant covers a position when its
 * scope id sits on the position. The metering module must not import identity, so it tests against this
 * fake (its permission table mirrors `ROLE_PERMISSIONS`).
 */
export class FakeAccessPolicy implements AccessPolicy {
  check(actor: Actor, permission: string, resource: ResourcePosition): Result<string, DomainError> {
    if (!actor.active || actor.tenantId !== resource.tenantId) return err(new ForbiddenError("Denied"));
    const granting = actor.grants.find(
      (grant) => grantsPermission(grant, permission) && idAt(grant.scopeType, resource) === grant.scopeId,
    );
    return granting ? ok(granting.role) : err(new ForbiddenError("Denied"));
  }
}
