import type {
  BusinessUnitRepository,
  OperationAdd,
  OperationRepository,
  OperationUpdate,
  SetArchivedAt,
  SetOperationArchivedAt,
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

type Row = { readonly id: string; readonly tenantId: string; readonly name: string; readonly archivedAt: Date | null };

const sorted = <T extends Row>(rows: readonly T[], tenantId: string): readonly T[] =>
  rows
    .filter((row) => row.tenantId === tenantId)
    .sort(compareByName);

const byId = <T extends Row>(rows: readonly T[], tenantId: string, id: string): T | null =>
  rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;

type Owned = Row & { readonly businessUnitId?: string };

/**
 * The partial unique name index: the same tenant, the same owner (operations only) and the same
 * name key, among ACTIVE rows. An archived row never collides.
 */
const collides = (rows: readonly Owned[], candidate: Owned, ignoreId?: string): boolean =>
  rows.some(
    (row) =>
      row.archivedAt === null &&
      row.id !== ignoreId &&
      row.tenantId === candidate.tenantId &&
      row.businessUnitId === candidate.businessUnitId &&
      nameKey(row.name) === nameKey(candidate.name),
  );

const insertRow = <T extends Owned>(rows: T[], row: T): boolean => {
  if (rows.some((existing) => existing.id === row.id)) throw new Error("unique violation on id");
  if (row.archivedAt === null && collides(rows, row)) return false;
  rows.push(row);
  return true;
};

const renameRow = (rows: Owned[], tenantId: string, id: string, name: string): boolean => {
  const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
  if (index < 0) throw new Error(`rename of a missing row ${id}`);
  const current = rows[index] as Owned;
  if (current.archivedAt === null && collides(rows, { ...current, name }, id)) return false;
  rows[index] = { ...current, name };
  return true;
};

/** Archives or restores a row; a restore (null) is checked against the active names like an insert. */
const archiveRow = (rows: Owned[], tenantId: string, id: string, archivedAt: Date | null): SetArchivedAt => {
  const index = rows.findIndex((row) => row.tenantId === tenantId && row.id === id);
  if (index < 0) throw new Error(`archive of a missing row ${id}`);
  const next = { ...(rows[index] as Owned), archivedAt };
  if (archivedAt === null && collides(rows, next, id)) return "name_taken";
  rows[index] = next;
  return "done";
};

const active = <T extends Row>(rows: readonly T[], tenantId: string): T[] =>
  rows.filter((row) => row.tenantId === tenantId && row.archivedAt === null);

export class InMemoryBusinessUnitRepository implements BusinessUnitRepository {
  constructor(private readonly state: OrganizationState) {}

  /** The in-memory unit of work is single-threaded: nothing to lock. */
  lock(): Promise<void> {
    return Promise.resolve();
  }

  findById(tenantId: string, id: string): Promise<BusinessUnit | null> {
    return Promise.resolve(byId(this.state.businessUnits, tenantId, id));
  }

  findByName(tenantId: string, key: string): Promise<BusinessUnit | null> {
    const found = active(this.state.businessUnits, tenantId).find((u) => nameKey(u.name) === key);
    return Promise.resolve(found ?? null);
  }

  add(unit: BusinessUnit): Promise<boolean> {
    return Promise.resolve(insertRow(this.state.businessUnits, unit));
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return Promise.resolve(renameRow(this.state.businessUnits, tenantId, id, name));
  }

  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt> {
    return Promise.resolve(archiveRow(this.state.businessUnits, tenantId, id, archivedAt));
  }

  listByTenant(tenantId: string): Promise<readonly BusinessUnit[]> {
    return Promise.resolve(sorted(this.state.businessUnits, tenantId));
  }
}

export class InMemoryOperationRepository implements OperationRepository {
  constructor(private readonly state: OrganizationState) {}

  /** The in-memory unit of work is single-threaded: nothing to lock. */
  lock(): Promise<void> {
    return Promise.resolve();
  }

  findById(tenantId: string, id: string): Promise<Operation | null> {
    return Promise.resolve(byId(this.state.operations, tenantId, id));
  }

  findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null> {
    const found = active(this.state.operations, tenantId).find(
      (o) => o.businessUnitId === businessUnitId && nameKey(o.name) === key,
    );
    return Promise.resolve(found ?? null);
  }

  findByCostCenter(tenantId: string, costCenter: string): Promise<Operation | null> {
    const found = active(this.state.operations, tenantId).find((o) => o.costCenter === costCenter);
    return Promise.resolve(found ?? null);
  }

  countActiveByBusinessUnit(tenantId: string, businessUnitId: string): Promise<number> {
    return Promise.resolve(active(this.state.operations, tenantId).filter((o) => o.businessUnitId === businessUnitId).length);
  }

  countActiveBySite(tenantId: string, siteId: string): Promise<number> {
    return Promise.resolve(active(this.state.operations, tenantId).filter((o) => o.siteId === siteId).length);
  }

  /** Mirrors the two partial unique indexes: name per division first, then cost center per tenant. */
  add(operation: Operation): Promise<OperationAdd> {
    const rows = this.state.operations;
    if (rows.some((existing) => existing.id === operation.id)) throw new Error("unique violation on id");
    const conflict = operation.archivedAt === null ? this.conflictOf(operation) : null;
    if (conflict !== null) return Promise.resolve(conflict);
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
    const conflict = operation.archivedAt === null ? this.conflictOf(operation, operation.id) : null;
    if (conflict !== null) return Promise.resolve(conflict);
    rows[index] = operation;
    return Promise.resolve("updated");
  }

  /** A restore (null) is checked against the active names and cost centers like an insert. */
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetOperationArchivedAt> {
    const rows = this.state.operations;
    const index = rows.findIndex((o) => o.tenantId === tenantId && o.id === id);
    if (index < 0) throw new Error(`archive of a missing row ${id}`);
    const next = { ...(rows[index] as Operation), archivedAt };
    const conflict = archivedAt === null ? this.conflictOf(next, id) : null;
    if (conflict !== null) return Promise.resolve(conflict);
    rows[index] = next;
    return Promise.resolve("done");
  }

  listByTenant(tenantId: string): Promise<readonly Operation[]> {
    return Promise.resolve(sorted(this.state.operations, tenantId));
  }

  /** Which partial unique index an active row would violate: name per division, then cost center. */
  private conflictOf(operation: Operation, ignoreId?: string): "name_taken" | "cost_center_taken" | null {
    const rows = this.state.operations;
    if (collides(rows, operation, ignoreId)) return "name_taken";
    const sameCode = rows.some(
      (o) =>
        o.archivedAt === null &&
        o.id !== ignoreId &&
        o.tenantId === operation.tenantId &&
        o.costCenter === operation.costCenter,
    );
    return sameCode ? "cost_center_taken" : null;
  }
}

export class InMemorySiteRepository implements SiteRepository {
  constructor(private readonly state: OrganizationState) {}

  lock(): Promise<void> {
    return Promise.resolve();
  }

  findById(tenantId: string, id: string): Promise<Site | null> {
    return Promise.resolve(byId(this.state.sites, tenantId, id));
  }

  findByName(tenantId: string, key: string): Promise<Site | null> {
    const found = active(this.state.sites, tenantId).find((s) => nameKey(s.name) === key);
    return Promise.resolve(found ?? null);
  }

  add(site: Site): Promise<boolean> {
    return Promise.resolve(insertRow(this.state.sites, site));
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return Promise.resolve(renameRow(this.state.sites, tenantId, id, name));
  }

  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt> {
    return Promise.resolve(archiveRow(this.state.sites, tenantId, id, archivedAt));
  }

  listByTenant(tenantId: string): Promise<readonly Site[]> {
    return Promise.resolve(sorted(this.state.sites, tenantId));
  }
}
