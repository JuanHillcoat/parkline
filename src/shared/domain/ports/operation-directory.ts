/**
 * What another module needs to know about an operation: where it sits in the hierarchy and
 * whether it can still receive work. `archivedAt` is set when the operation is archived, and
 * implementers also report it when its site or its division is archived.
 */
export type OperationInfo = {
  readonly id: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly archivedAt: Date | null;
};

/** What another module needs to know about a site: whether it can still receive a spare. */
export type SiteInfo = {
  readonly id: string;
  readonly archivedAt: Date | null;
};

/**
 * Lets a module that attaches records to operations and sites (fleet assignments) read them without
 * importing the organization module (ADR-0005). Every query is scoped by tenant; a row of another
 * tenant is never visible, exactly like a missing one. Both reads take a shared row lock on the parents
 * first (division, site, operation), held until the caller's transaction ends.
 */
export interface OperationDirectory {
  find(tenantId: string, operationId: string): Promise<OperationInfo | null>;
  findSite(tenantId: string, siteId: string): Promise<SiteInfo | null>;
}
