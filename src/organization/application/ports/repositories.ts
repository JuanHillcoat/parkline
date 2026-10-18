import type { BusinessUnit, Operation, Site } from "../../domain/entities";

// Every query takes the tenant id: a row of another tenant is never visible.
// `*ByName` receives the normalized key (`nameKey`) and returns the owner's match.
// `add` and `rename` report a unique index rejection (a concurrent writer took the
// name or the cost center first) as a value, not an exception.

export interface BusinessUnitRepository {
  findById(tenantId: string, id: string): Promise<BusinessUnit | null>;
  findByName(tenantId: string, key: string): Promise<BusinessUnit | null>;
  add(unit: BusinessUnit): Promise<boolean>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  listByTenant(tenantId: string): Promise<readonly BusinessUnit[]>;
}

/** What `OperationRepository.add` reports: stored, or which unique index rejected the write. */
export type OperationAdd = "added" | "name_taken" | "cost_center_taken";

export interface OperationRepository {
  findById(tenantId: string, id: string): Promise<Operation | null>;
  findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null>;
  findByCostCenter(tenantId: string, costCenter: string): Promise<Operation | null>;
  add(operation: Operation): Promise<OperationAdd>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  listByTenant(tenantId: string): Promise<readonly Operation[]>;
}

export interface SiteRepository {
  findById(tenantId: string, id: string): Promise<Site | null>;
  findByName(tenantId: string, key: string): Promise<Site | null>;
  add(site: Site): Promise<boolean>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  listByTenant(tenantId: string): Promise<readonly Site[]>;
}
