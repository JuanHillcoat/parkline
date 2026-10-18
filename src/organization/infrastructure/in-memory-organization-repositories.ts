import type {
  BusinessUnitRepository,
  OperationRepository,
  OperationSiteRepository,
  SiteRepository,
} from "../application/ports/repositories";
import type { BusinessUnit, Operation, OperationSite, Site } from "../domain/entities";
import { nameKey } from "../domain/name";
import { compareByName } from "./row-order";

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
    .sort(compareByName);

const byId = <T extends Row>(rows: readonly T[], tenantId: string, id: string): T | null =>
  rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;

type Owned = Row & { readonly businessUnitId?: string };

/** The unique name index: the same tenant, the same owner (operations only) and the same name key. */
const collides = (rows: readonly Owned[], candidate: Owned, ignoreId?: string): boolean =>
  rows.some(
    (row) =>
      row.id !== ignoreId &&
      row.tenantId === candidate.tenantId &&
      row.businessUnitId === candidate.businessUnitId &&
      nameKey(row.name) === nameKey(candidate.name),
  );

const insertRow = <T extends Owned>(rows: T[], row: T): boolean => {
  if (rows.some((existing) => existing.id === row.id)) throw new Error("unique violation on id");
  if (collides(rows, row)) return false;
  rows.push(row);
  return true;
};

const renameRow = (rows: Owned[], tenantId: string, id: string, name: string): boolean => {
  const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
  if (index < 0) throw new Error(`rename of a missing row ${id}`);
  const current = rows[index] as Owned;
  if (collides(rows, { ...current, name }, id)) return false;
  rows[index] = { ...current, name };
  return true;
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

  add(unit: BusinessUnit): Promise<boolean> {
    return Promise.resolve(insertRow(this.state.businessUnits, unit));
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return Promise.resolve(renameRow(this.state.businessUnits, tenantId, id, name));
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

  add(operation: Operation): Promise<boolean> {
    return Promise.resolve(insertRow(this.state.operations, operation));
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return Promise.resolve(renameRow(this.state.operations, tenantId, id, name));
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

  add(site: Site): Promise<boolean> {
    return Promise.resolve(insertRow(this.state.sites, site));
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return Promise.resolve(renameRow(this.state.sites, tenantId, id, name));
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

  add(link: OperationSite): Promise<boolean> {
    const taken = this.state.links.some(
      (l) => l.tenantId === link.tenantId && l.operationId === link.operationId && l.siteId === link.siteId,
    );
    if (!taken) this.state.links.push(link);
    return Promise.resolve(!taken);
  }

  listByTenant(tenantId: string): Promise<readonly OperationSite[]> {
    return Promise.resolve(this.state.links.filter((l) => l.tenantId === tenantId));
  }
}
