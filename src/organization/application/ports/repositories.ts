import type { BusinessUnit, Operation, OperationSite, Site } from "../../domain/entities";
import type { ShiftProfile } from "../../domain/shift-profile";

// Every query takes the tenant id: a row of another tenant is never visible.
// `*ByName` receives the normalized key (`nameKey`) and returns the owner's match.

export interface BusinessUnitRepository {
  findById(tenantId: string, id: string): Promise<BusinessUnit | null>;
  findByName(tenantId: string, key: string): Promise<BusinessUnit | null>;
  add(unit: BusinessUnit): Promise<void>;
  rename(tenantId: string, id: string, name: string): Promise<void>;
  listByTenant(tenantId: string): Promise<readonly BusinessUnit[]>;
}

export interface OperationRepository {
  findById(tenantId: string, id: string): Promise<Operation | null>;
  findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null>;
  add(operation: Operation): Promise<void>;
  rename(tenantId: string, id: string, name: string): Promise<void>;
  listByTenant(tenantId: string): Promise<readonly Operation[]>;
}

export interface SiteRepository {
  findById(tenantId: string, id: string): Promise<Site | null>;
  findByName(tenantId: string, key: string): Promise<Site | null>;
  add(site: Site): Promise<void>;
  rename(tenantId: string, id: string, name: string): Promise<void>;
  listByTenant(tenantId: string): Promise<readonly Site[]>;
}

export interface OperationSiteRepository {
  find(tenantId: string, operationId: string, siteId: string): Promise<OperationSite | null>;
  add(link: OperationSite): Promise<void>;
  listByTenant(tenantId: string): Promise<readonly OperationSite[]>;
}

export interface ShiftProfileRepository {
  /** Every version of the operation, oldest first. */
  listByOperation(tenantId: string, operationId: string): Promise<readonly ShiftProfile[]>;
  /** Stores the full history produced by `setShiftProfile` (closed versions plus the new open one). */
  replaceForOperation(
    tenantId: string,
    operationId: string,
    versions: readonly ShiftProfile[],
  ): Promise<void>;
}
