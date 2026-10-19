import type { BusinessUnit, Operation, Site } from "../../src/organization/domain/entities";

/** `siteName` is null when the operation's site is not in the visible list. */
export type OperationRow = {
  readonly id: string;
  readonly name: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly costCenter: string;
  readonly siteName: string | null;
  readonly archived: boolean;
};

/** `id` and `name` are null for the operations whose division the actor cannot see. */
export type DivisionGroup = {
  readonly id: string | null;
  readonly name: string | null;
  readonly archived: boolean;
  /** The operations shown in the group that are not archived. */
  readonly activeOperations: number;
  readonly operations: readonly OperationRow[];
};

/** `operationCount` counts only the active operations located at the site. */
export type SiteRow = {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly operationCount: number;
};

export const siteNamesById = (sites: readonly Site[]): ReadonlyMap<string, string> =>
  new Map(sites.map((site) => [site.id, site.name]));

export const countActiveOperationsBySite = (operations: readonly Operation[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const operation of operations.filter((o) => o.archivedAt === null)) counts.set(operation.siteId, (counts.get(operation.siteId) ?? 0) + 1);
  return counts;
};

const toRow = (operation: Operation, siteNames: ReadonlyMap<string, string>): OperationRow => ({
  id: operation.id,
  name: operation.name,
  businessUnitId: operation.businessUnitId,
  siteId: operation.siteId,
  costCenter: operation.costCenter,
  siteName: siteNames.get(operation.siteId) ?? null,
  archived: operation.archivedAt !== null,
});

const countActive = (rows: readonly OperationRow[]): number => rows.filter((row) => !row.archived).length;

/** Pure view model for the divisions; order is the order of the (already sorted) lists. */
export const buildDivisionGroups = (
  units: readonly BusinessUnit[],
  operations: readonly Operation[],
  siteNames: ReadonlyMap<string, string>,
): DivisionGroup[] => {
  const rows = operations.map((operation) => toRow(operation, siteNames));
  const known = new Set(units.map((unit) => unit.id));
  const groups = units.map((unit) => {
    const own = rows.filter((row) => row.businessUnitId === unit.id);
    return { id: unit.id, name: unit.name, archived: unit.archivedAt !== null, activeOperations: countActive(own), operations: own };
  });
  const hidden = rows.filter((row) => !known.has(row.businessUnitId));
  const other = { id: null, name: null, archived: false, activeOperations: countActive(hidden), operations: hidden };
  return hidden.length === 0 ? groups : [...groups, other];
};

/** Pure view model for the sites card. */
export const buildSiteRows = (sites: readonly Site[], operations: readonly Operation[]): SiteRow[] => {
  const counts = countActiveOperationsBySite(operations);
  return sites.map((site) => ({
    id: site.id,
    name: site.name,
    archived: site.archivedAt !== null,
    operationCount: counts.get(site.id) ?? 0,
  }));
};

/** The archived view is requested with `?archived=1`; any other value, or a repeated key, means off. */
export const wantsArchived = (flag: string | readonly string[] | undefined): boolean => flag === "1";

/** The link of the toggle: it leads to the other view. */
export const archivedToggleHref = (showingArchived: boolean): string =>
  showingArchived ? "/organization" : "/organization?archived=1";
