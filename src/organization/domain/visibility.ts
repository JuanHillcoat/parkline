import type { ResourcePosition } from "../../shared/domain/ports/access-policy";
import type { BusinessUnit, Operation, OperationSite, Site } from "./entities";

/**
 * Whether the actor holds `catalog.read` over a resource position. The use case
 * builds it from the shared `AccessPolicy`, so this module never knows roles.
 */
export type CanRead = (position: ResourcePosition) => boolean;

const operationPosition = (operation: Operation): ResourcePosition => ({
  tenantId: operation.tenantId,
  businessUnitId: operation.businessUnitId,
  operationId: operation.id,
});

const sitePosition = (site: Site): ResourcePosition => ({ tenantId: site.tenantId, siteId: site.id });

/** A link sits at every level at once, so any scope of its operation, unit or site covers it. */
const linkPosition = (operation: Operation, link: OperationSite): ResourcePosition => ({
  ...operationPosition(operation),
  siteId: link.siteId,
});

/**
 * D4. A unit is visible only through a tenant or business unit grant: an
 * operation-scoped user does not see its parent unit (decision: nothing in the
 * catalog screens needs it, and showing it would widen the grant).
 */
export const visibleBusinessUnits = (units: readonly BusinessUnit[], canRead: CanRead): BusinessUnit[] =>
  units.filter((unit) => canRead({ tenantId: unit.tenantId, businessUnitId: unit.id }));

/** An operation is visible directly, or through any site linked to it (site scope). */
export const visibleOperations = (
  operations: readonly Operation[],
  links: readonly OperationSite[],
  canRead: CanRead,
): Operation[] =>
  operations.filter(
    (operation) =>
      canRead(operationPosition(operation)) ||
      links.some((link) => link.operationId === operation.id && canRead(linkPosition(operation, link))),
  );

/** A site is visible directly, or through any operation linked to it (unit or operation scope). */
export const visibleSites = (
  sites: readonly Site[],
  operations: readonly Operation[],
  links: readonly OperationSite[],
  canRead: CanRead,
): Site[] => {
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  const viaLink = (site: Site): boolean =>
    links.some((link) => {
      const operation = byId.get(link.operationId);
      return link.siteId === site.id && operation !== undefined && canRead(linkPosition(operation, link));
    });
  return sites.filter((site) => canRead(sitePosition(site)) || viaLink(site));
};
