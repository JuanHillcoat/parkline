import type { ResourcePosition } from "../../shared/domain/ports/access-policy";
import type { BusinessUnit, Operation, Site } from "./entities";

/**
 * Whether the actor holds `catalog.read` over a resource position. The use case
 * builds it from the shared `AccessPolicy`, so this module never knows roles.
 */
export type CanRead = (position: ResourcePosition) => boolean;

/** An operation sits at every level at once: tenant, division, itself and its site. */
const operationPosition = (operation: Operation): ResourcePosition => ({
  tenantId: operation.tenantId,
  businessUnitId: operation.businessUnitId,
  operationId: operation.id,
  siteId: operation.siteId,
});

const sitePosition = (site: Site): ResourcePosition => ({ tenantId: site.tenantId, siteId: site.id });

/**
 * D4. A division is visible only through a tenant or division grant: an
 * operation-scoped user does not see its parent division (nothing in the
 * catalog screens needs it, and showing it would widen the grant).
 */
export const visibleBusinessUnits = (units: readonly BusinessUnit[], canRead: CanRead): BusinessUnit[] =>
  units.filter((unit) => canRead({ tenantId: unit.tenantId, businessUnitId: unit.id }));

/**
 * An operation is visible when its position passes: a tenant scope, its
 * division scope, its own scope or the scope of its site covers it.
 */
export const visibleOperations = (operations: readonly Operation[], canRead: CanRead): Operation[] =>
  operations.filter((operation) => canRead(operationPosition(operation)));

/** A site is visible through its own position, or through any visible operation located at it. */
export const visibleSites = (
  sites: readonly Site[],
  operations: readonly Operation[],
  canRead: CanRead,
): Site[] => {
  const atVisibleOperation = new Set(visibleOperations(operations, canRead).map((operation) => operation.siteId));
  return sites.filter((site) => canRead(sitePosition(site)) || atVisibleOperation.has(site.id));
};
