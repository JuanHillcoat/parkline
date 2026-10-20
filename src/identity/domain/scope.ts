import { ValidationError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";

export type ScopeType = "tenant" | "business_unit" | "operation" | "site";

const SCOPE_TYPES: readonly string[] = ["tenant", "business_unit", "operation", "site"];

/** Validates a raw scope type coming from a form or another caller. */
export const parseScopeType = (value: string): Result<ScopeType, ValidationError> =>
  SCOPE_TYPES.includes(value)
    ? ok(value as ScopeType)
    : err(new ValidationError(`Unknown scope type ${value}`, "scope.type"));

/** A grant boundary: a node of the organizational hierarchy. */
export type Scope = { readonly type: ScopeType; readonly id: string };

/** The position of a resource in the hierarchy. Levels it does not belong to are omitted. */
export type ResourceScope = {
  readonly tenantId: string;
  readonly businessUnitId?: string;
  readonly operationId?: string;
  readonly siteId?: string;
};

const resourceIdAt = (type: ScopeType, resource: ResourceScope): string | undefined => {
  switch (type) {
    case "tenant":
      return resource.tenantId;
    case "business_unit":
      return resource.businessUnitId;
    case "operation":
      return resource.operationId;
    case "site":
      return resource.siteId;
  }
};

/**
 * Whether `scope` covers `resource` within `tenantId`. A resource of another
 * tenant is never covered, even when the scope id matches one of its ids.
 */
export const scopeCovers = (scope: Scope, resource: ResourceScope, tenantId: string): boolean => {
  if (resource.tenantId !== tenantId) return false;
  const resourceId = resourceIdAt(scope.type, resource);
  return resourceId !== undefined && resourceId === scope.id;
};
