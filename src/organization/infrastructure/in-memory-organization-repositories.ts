import type {
  BusinessUnitRepository,
  OperationRepository,
  OperationSiteRepository,
  SiteRepository,
} from "../application/ports/repositories";
import type { BusinessUnit, Operation, OperationSite, Site } from "../domain/entities";
import { nameKey } from "../domain/name";

/** The data of one in-memory organization database. A transaction works on a copy. */
export type OrganizationState = {
  businessUnits: BusinessUnit[];
  operations: Operation[];
  sites: Site[];
  links: OperationSite[];
};

export const emptyState = (): OrganizationState => ({
  businessUnits: [],
  operations: [],
  sites: [],
  links: [],
});

type Row = { readonly id: string; readonly tenantId: string; readonly name: string };

const sorted = <T extends Row>(rows: readonly T[], tenantId: string): readonly T[] =>
  rows
    .filter((row) => row.tenantId === tenantId)
    .sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)) || a.id.localeCompare(b.id));

const byId = <T extends Row>(rows: readonly T[], tenantId: string, id: string): T | null =>
  rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;

const renameRow = (rows: Row[], tenantId: string, id: string, name: string): void => {
  const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
  if (index < 0) throw new Error(`rename of a missing row ${id}`);
  rows[index] = { ...(rows[index] as Row), name };
};

const duplicateId = (rows: readonly Row[], id: string): void => {
  if (rows.some((row) => row.id === id)) throw new Error("unique violation on id");
};

export class InMemoryBusinessUnitRepository implements BusinessUnitRepository {
  constructor(private readonly state: OrganizationState) {}

  findById(tenantId: string, id: string): Promise<BusinessUnit | null> {
    return Promise.resolve(byId(this.state.businessUnits, tenantId, id));
  }

  findByName(tenantId: string, key: string): Promise<BusinessUnit | null> {
    const found = this.state.businessUnits.find((u) => u.tenantId === tenantId && nameKey(u.name) === key);
    return Promise.resolve(found ?? null);
  }

  add(unit: BusinessUnit): Promise<void> {
    duplicateId(this.state.businessUnits, unit.id);
    this.state.businessUnits.push(unit);
    return Promise.resolve();
  }

  rename(tenantId: string, id: string, name: string): Promise<void> {
    renameRow(this.state.businessUnits, tenantId, id, name);
    return Promise.resolve();
  }

  listByTenant(tenantId: string): Promise<readonly BusinessUnit[]> {
    return Promise.resolve(sorted(this.state.businessUnits, tenantId));
  }
}

export class InMemoryOperationRepository implements OperationRepository {
  constructor(private readonly state: OrganizationState) {}

  findById(tenantId: string, id: string): Promise<Operation | null> {
    return Promise.resolve(byId(this.state.operations, tenantId, id));
  }

  findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null> {
    const found = this.state.operations.find(
      (o) => o.tenantId === tenantId && o.businessUnitId === businessUnitId && nameKey(o.name) === key,
    );
    return Promise.resolve(found ?? null);
  }

  add(operation: Operation): Promise<void> {
    duplicateId(this.state.operations, operation.id);
    this.state.operations.push(operation);
    return Promise.resolve();
  }

  rename(tenantId: string, id: string, name: string): Promise<void> {
    renameRow(this.state.operations, tenantId, id, name);
    return Promise.resolve();
  }

  listByTenant(tenantId: string): Promise<readonly Operation[]> {
    return Promise.resolve(sorted(this.state.operations, tenantId));
  }
}

export class InMemorySiteRepository implements SiteRepository {
  constructor(private readonly state: OrganizationState) {}

  findById(tenantId: string, id: string): Promise<Site | null> {
    return Promise.resolve(byId(this.state.sites, tenantId, id));
  }

  findByName(tenantId: string, key: string): Promise<Site | null> {
    const found = this.state.sites.find((s) => s.tenantId === tenantId && nameKey(s.name) === key);
    return Promise.resolve(found ?? null);
  }

  add(site: Site): Promise<void> {
    duplicateId(this.state.sites, site.id);
    this.state.sites.push(site);
    return Promise.resolve();
  }

  rename(tenantId: string, id: string, name: string): Promise<void> {
    renameRow(this.state.sites, tenantId, id, name);
    return Promise.resolve();
  }

  listByTenant(tenantId: string): Promise<readonly Site[]> {
    return Promise.resolve(sorted(this.state.sites, tenantId));
  }
}

export class InMemoryOperationSiteRepository implements OperationSiteRepository {
  constructor(private readonly state: OrganizationState) {}

  find(tenantId: string, operationId: string, siteId: string): Promise<OperationSite | null> {
    const found = this.state.links.find(
      (l) => l.tenantId === tenantId && l.operationId === operationId && l.siteId === siteId,
    );
    return Promise.resolve(found ?? null);
  }

  add(link: OperationSite): Promise<void> {
    this.state.links.push(link);
    return Promise.resolve();
  }

  listByTenant(tenantId: string): Promise<readonly OperationSite[]> {
    return Promise.resolve(this.state.links.filter((l) => l.tenantId === tenantId));
  }
}
