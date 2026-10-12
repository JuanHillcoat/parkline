export type ScopeType = "tenant" | "business_unit" | "operation" | "site";

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
