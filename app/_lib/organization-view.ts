import type { BusinessUnit, Operation, Site } from "../../src/organization/domain/entities";

/** `siteName` is null when the operation's site is not in the visible list. */
export type OperationRow = {
  readonly id: string;
  readonly name: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly costCenter: string;
  readonly siteName: string | null;
};

/** `id` and `name` are null for the operations whose division the actor cannot see. */
export type DivisionGroup = {
  readonly id: string | null;
  readonly name: string | null;
  readonly operations: readonly OperationRow[];
};

export type SiteRow = { readonly id: string; readonly name: string; readonly operationCount: number };

export const siteNamesById = (sites: readonly Site[]): ReadonlyMap<string, string> =>
  new Map(sites.map((site) => [site.id, site.name]));

export const countOperationsBySite = (operations: readonly Operation[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const operation of operations) counts.set(operation.siteId, (counts.get(operation.siteId) ?? 0) + 1);
  return counts;
};

const toRow = (operation: Operation, siteNames: ReadonlyMap<string, string>): OperationRow => ({
  id: operation.id,
  name: operation.name,
  businessUnitId: operation.businessUnitId,
  siteId: operation.siteId,
  costCenter: operation.costCenter,
  siteName: siteNames.get(operation.siteId) ?? null,
});

/** Pure view model for the divisions; order is the order of the (already sorted) lists. */
export const buildDivisionGroups = (
  units: readonly BusinessUnit[],
  operations: readonly Operation[],
  siteNames: ReadonlyMap<string, string>,
): DivisionGroup[] => {
  const rows = operations.map((operation) => toRow(operation, siteNames));
  const known = new Set(units.map((unit) => unit.id));
  const groups = units.map((unit) => ({
    id: unit.id,
    name: unit.name,
    operations: rows.filter((row) => row.businessUnitId === unit.id),
  }));
  const hidden = rows.filter((row) => !known.has(row.businessUnitId));
  return hidden.length === 0 ? groups : [...groups, { id: null, name: null, operations: hidden }];
};

/** Pure view model for the sites card. */
export const buildSiteRows = (sites: readonly Site[], operations: readonly Operation[]): SiteRow[] => {
  const counts = countOperationsBySite(operations);
  return sites.map((site) => ({ id: site.id, name: site.name, operationCount: counts.get(site.id) ?? 0 }));
};
