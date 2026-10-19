import type { BusinessUnit, Operation, Site } from "../../domain/entities";

// Every query takes the tenant id: a row of another tenant is never visible.
// `*ByName` and `findByCostCenter` receive the normalized key and match ACTIVE rows only:
// an archived row owns no name and no cost center (D5). `findById` and `listByTenant` return
// archived rows too; the use cases filter them.
// `add`, `rename`, `update` and `setArchivedAt` report a unique index rejection (a concurrent
// writer took the name or the cost center first) as a value, not an exception.

/**
 * What `setArchivedAt` reports: stored, which unique index rejected a restore, or that the row was
 * no longer in the state the caller read (a concurrent request archived or restored it first).
 */
export type SetArchivedAt = "done" | "name_taken" | "state_changed";

/** The same for operations, which also own a cost center. */
export type SetOperationArchivedAt = SetArchivedAt | "cost_center_taken";

/**
 * Row lock on a division or site, held until the transaction ends. A writer of an operation takes
 * "share" before it reads the parent's `archivedAt`; an archive takes "exclusive" before it counts
 * the active operations. Either order then sees the other's committed write (D3/D4 under concurrency).
 */
export type ParentLock = "share" | "exclusive";

export interface BusinessUnitRepository {
  lock(tenantId: string, id: string, mode: ParentLock): Promise<void>;
  findById(tenantId: string, id: string): Promise<BusinessUnit | null>;
  findByName(tenantId: string, key: string): Promise<BusinessUnit | null>;
  add(unit: BusinessUnit): Promise<boolean>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  /** Archives (a date) or restores (null) an existing row; a restore can lose the name to an active row. */
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt>;
  listByTenant(tenantId: string): Promise<readonly BusinessUnit[]>;
}

/** What `OperationRepository.add` reports: stored, or which unique index rejected the write. */
export type OperationAdd = "added" | "name_taken" | "cost_center_taken";

/** What `OperationRepository.update` reports: stored, or which unique index rejected the write. */
export type OperationUpdate = "updated" | "name_taken" | "cost_center_taken";

export interface OperationRepository {
  findById(tenantId: string, id: string): Promise<Operation | null>;
  findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null>;
  findByCostCenter(tenantId: string, costCenter: string): Promise<Operation | null>;
  /** How many ACTIVE operations belong to the division / are located at the site. */
  countActiveByBusinessUnit(tenantId: string, businessUnitId: string): Promise<number>;
  countActiveBySite(tenantId: string, siteId: string): Promise<number>;
  add(operation: Operation): Promise<OperationAdd>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  /** Replaces name, division, site and cost center of an existing operation (it must exist). */
  update(operation: Operation): Promise<OperationUpdate>;
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetOperationArchivedAt>;
  listByTenant(tenantId: string): Promise<readonly Operation[]>;
}

export interface SiteRepository {
  lock(tenantId: string, id: string, mode: ParentLock): Promise<void>;
  findById(tenantId: string, id: string): Promise<Site | null>;
  findByName(tenantId: string, key: string): Promise<Site | null>;
  add(site: Site): Promise<boolean>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt>;
  listByTenant(tenantId: string): Promise<readonly Site[]>;
}
