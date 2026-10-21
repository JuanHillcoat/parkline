import type { Equipment } from "../../src/fleet/domain/entities";

/** The most groups a distribution shows before the rest are folded into "others". */
export const TOP_GROUPS = 5;

export type Slice = {
  readonly label: string;
  readonly count: number;
  /** Whole percentage of the active equipment; the slices of a distribution add up to 100. */
  readonly percent: number;
  readonly isOther: boolean;
};

export type Distribution = { readonly total: number; readonly slices: readonly Slice[] };

export type KpiKey = "equipment" | "suppliers" | "assetTypes" | "divisions" | "operations" | "sites";
export type Kpi = { readonly key: KpiKey; readonly count: number; readonly href: string };

const KPI_ORDER: readonly (readonly [KpiKey, string])[] = [
  ["equipment", "/fleet"],
  ["suppliers", "/fleet"],
  ["assetTypes", "/fleet"],
  ["divisions", "/organization"],
  ["operations", "/organization"],
  ["sites", "/organization"],
];

/** Rows that are not archived. */
export const countActive = (rows: readonly { readonly archivedAt: Date | null }[]): number =>
  rows.filter((row) => row.archivedAt === null).length;

/**
 * Drops the counts a scoped user cannot know. The lists are filtered by scope, so a user placed on
 * one operation sees that operation and its site but no division, and "0 divisions" would be false:
 * an operation always belongs to a division and has exactly one site. A real zero (nothing
 * registered, or a division with no operations yet) is kept.
 */
export function dropUnknowableCounts(counts: Partial<Record<KpiKey, number>>): Partial<Record<KpiKey, number>> {
  const kept = { ...counts };
  if ((kept.operations ?? 0) > 0 && kept.divisions === 0) delete kept.divisions;
  if ((kept.operations ?? 0) > 0 && kept.sites === 0) delete kept.sites;
  return kept;
}

/** The KPI cards in their fixed order, only for the counts that could be read. */
export const buildKpis = (counts: Partial<Record<KpiKey, number>>): Kpi[] =>
  KPI_ORDER.flatMap(([key, href]) => {
    const count = counts[key];
    return count === undefined ? [] : [{ key, count, href }];
  });

/** True when something could be read and all of it is empty: the moment to show the first steps. */
export const hasNoData = (kpis: readonly Kpi[]): boolean => kpis.length > 0 && kpis.every((kpi) => kpi.count === 0);

type Group = { readonly label: string; readonly count: number };

const byCountThenLabel = (a: Group, b: Group): number => b.count - a.count || a.label.localeCompare(b.label, "es");

/** Largest-remainder rounding, so the whole percentages always add up to 100. */
const percentages = (counts: readonly number[], total: number): number[] => {
  const exact = counts.map((count) => (count * 100) / total);
  const floors = exact.map(Math.floor);
  const missing = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) }));
  order.sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order.slice(0, missing)) floors[index] = (floors[index] ?? 0) + 1;
  return floors;
};

const tally = (active: readonly Equipment[], key: "supplierId" | "assetTypeId", names: ReadonlyMap<string, string>) => {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const unit of active) {
    const label = names.get(unit[key]);
    if (label === undefined) unknown += 1;
    else counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const groups = [...counts].map(([label, count]) => ({ label, count })).sort(byCountThenLabel);
  return { groups, unknown };
};

/** Active equipment grouped by supplier or asset type: the top groups plus "others" when there are more. */
export const distribute = (
  equipment: readonly Equipment[],
  key: "supplierId" | "assetTypeId",
  names: ReadonlyMap<string, string>,
  othersLabel: string,
  limit: number = TOP_GROUPS,
): Distribution => {
  const active = equipment.filter((unit) => unit.archivedAt === null);
  if (active.length === 0) return { total: 0, slices: [] };
  const { groups, unknown } = tally(active, key, names);
  const rest = groups.slice(limit).reduce((sum, group) => sum + group.count, 0) + unknown;
  const shown: (Group & { isOther: boolean })[] = groups.slice(0, limit).map((group) => ({ ...group, isOther: false }));
  if (rest > 0) shown.push({ label: othersLabel, count: rest, isOther: true });
  const percent = percentages(shown.map((group) => group.count), active.length);
  return { total: active.length, slices: shown.map((group, i) => ({ ...group, percent: percent[i] ?? 0 })) };
};
