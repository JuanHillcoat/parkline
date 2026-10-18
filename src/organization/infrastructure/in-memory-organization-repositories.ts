import type {
  BusinessUnitRepository,
  OperationAdd,
  OperationRepository,
  OperationUpdate,
  SiteRepository,
} from "../application/ports/repositories";
import type { BusinessUnit, Operation, Site } from "../domain/entities";
import { nameKey } from "../domain/name";
import { compareByName } from "./row-order";

/** The data of one in-memory organization database. A transaction works on a copy. */
export type OrganizationState = {
  businessUnits: BusinessUnit[];
  operations: Operation[];
  sites: Site[];
};

export const emptyState = (): OrganizationState => ({
  businessUnits: [],
  operations: [],
  sites: [],
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

  findByCostCenter(tenantId: string, costCenter: string): Promise<Operation | null> {
    const found = this.state.operations.find((o) => o.tenantId === tenantId && o.costCenter === costCenter);
    return Promise.resolve(found ?? null);
  }

  /** Mirrors the two unique indexes: name per division first, then cost center per tenant. */
  add(operation: Operation): Promise<OperationAdd> {
    const rows = this.state.operations;
    if (rows.some((existing) => existing.id === operation.id)) throw new Error("unique violation on id");
    if (collides(rows, operation)) return Promise.resolve("name_taken");
    if (rows.some((o) => o.tenantId === operation.tenantId && o.costCenter === operation.costCenter)) {
      return Promise.resolve("cost_center_taken");
    }
    rows.push(operation);
    return Promise.resolve("added");
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return Promise.resolve(renameRow(this.state.operations, tenantId, id, name));
  }

  /** Mirrors the same two unique indexes, ignoring the row being updated. */
  update(operation: Operation): Promise<OperationUpdate> {
    const rows = this.state.operations;
    const index = rows.findIndex((o) => o.tenantId === operation.tenantId && o.id === operation.id);
    if (index < 0) throw new Error(`update of a missing row ${operation.id}`);
    if (collides(rows, operation, operation.id)) return Promise.resolve("name_taken");
    const sameCode = rows.some(
      (o) => o.id !== operation.id && o.tenantId === operation.tenantId && o.costCenter === operation.costCenter,
    );
    if (sameCode) return Promise.resolve("cost_center_taken");
    rows[index] = operation;
    return Promise.resolve("updated");
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
