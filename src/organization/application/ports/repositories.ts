import type { BusinessUnit, Operation, OperationSite, Site } from "../../domain/entities";

// Every query takes the tenant id: a row of another tenant is never visible.
// `*ByName` receives the normalized key (`nameKey`) and returns the owner's match.
// `add` and `rename` return false when the unique name index rejects the write (a
// concurrent writer took the name first): a conflict is a value, not an exception.

export interface BusinessUnitRepository {
  findById(tenantId: string, id: string): Promise<BusinessUnit | null>;
  findByName(tenantId: string, key: string): Promise<BusinessUnit | null>;
  add(unit: BusinessUnit): Promise<boolean>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  listByTenant(tenantId: string): Promise<readonly BusinessUnit[]>;
}

export interface OperationRepository {
  findById(tenantId: string, id: string): Promise<Operation | null>;
  findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null>;
  add(operation: Operation): Promise<boolean>;
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

export interface OperationSiteRepository {
  find(tenantId: string, operationId: string, siteId: string): Promise<OperationSite | null>;
  add(link: OperationSite): Promise<void>;
  listByTenant(tenantId: string): Promise<readonly OperationSite[]>;
}
