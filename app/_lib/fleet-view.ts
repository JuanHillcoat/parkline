import type { EquipmentListItem } from "../../src/fleet/application/equipment-visibility";
import type { AssetType, Equipment, Supplier } from "../../src/fleet/domain/entities";
import type { MeterKind } from "../../src/fleet/domain/values";
import { nameKey } from "../../src/shared/domain/catalog-name";
import { copy } from "./copy";

const t = copy.fleet;

export type Option = { readonly id: string; readonly name: string };

/** `activeEquipment` counts only the active equipment of the supplier. */
export type SupplierRow = {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly activeEquipment: number;
};

/** What the edit dialog of an asset type shows first; `interval` is blank when there is none. */
export type AssetTypeFormValues = { readonly name: string; readonly meterKind: MeterKind; readonly interval: string };

export type AssetTypeRow = {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
  readonly meterLabel: string;
  readonly intervalText: string;
  readonly activeEquipment: number;
  readonly form: AssetTypeFormValues;
};

/** Every field of the equipment form as text; blank when the value is not set. */
export type EquipmentFormValues = {
  readonly internalCode: string;
  readonly supplierId: string;
  readonly assetTypeId: string;
  readonly brand: string;
  readonly model: string;
  readonly year: string;
  readonly serialNumber: string;
  readonly batteryQuantity: string;
  readonly observations: string;
};

/** Where an equipment stands: `unassigned` has no open assignment (archived equipment never has one). */
export type EquipmentState = "active" | "spare" | "unassigned";

/** Names of the operations and sites the actor can read, by id (the organization lists are scope-filtered). */
export type Places = { readonly operations: readonly Option[]; readonly sites: readonly Option[] };

/** The operation and site names are null without an open assignment or when the organization list lacks them. */
export type EquipmentRow = {
  readonly id: string;
  readonly internalCode: string;
  readonly supplierName: string;
  readonly assetTypeName: string;
  readonly state: EquipmentState;
  readonly operationId: string | null;
  readonly operationName: string | null;
  readonly siteName: string | null;
  readonly brandModel: string | null;
  readonly year: number | null;
  readonly serialNumber: string | null;
  readonly batteryQuantity: number | null;
  readonly observations: string | null;
  readonly archived: boolean;
  readonly form: EquipmentFormValues;
};

type Counted = "supplierId" | "assetTypeId";

/** The interval is counted in the unit of the meter; a dash when there is no meter or no interval. */
export const intervalText = (kind: MeterKind, hours: number | null): string =>
  kind === "none" || hours === null ? t.noValue : `${String(hours)} ${t.interval[kind]}`;

export const countActiveEquipment = (equipment: readonly Equipment[], key: Counted): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const unit of equipment.filter((e) => e.archivedAt === null)) counts.set(unit[key], (counts.get(unit[key]) ?? 0) + 1);
  return counts;
};

export const buildSupplierRows = (suppliers: readonly Supplier[], equipment: readonly Equipment[]): SupplierRow[] => {
  const counts = countActiveEquipment(equipment, "supplierId");
  return suppliers.map((s) => ({ id: s.id, name: s.name, archived: s.archivedAt !== null, activeEquipment: counts.get(s.id) ?? 0 }));
};

const assetTypeRow = (type: AssetType, count: number): AssetTypeRow => ({
  id: type.id,
  name: type.name,
  archived: type.archivedAt !== null,
  meterLabel: t.meter[type.meterKind],
  intervalText: intervalText(type.meterKind, type.preventiveIntervalHours),
  activeEquipment: count,
  form: { name: type.name, meterKind: type.meterKind, interval: type.preventiveIntervalHours?.toString() ?? "" },
});

export const buildAssetTypeRows = (types: readonly AssetType[], equipment: readonly Equipment[]): AssetTypeRow[] => {
  const counts = countActiveEquipment(equipment, "assetTypeId");
  return types.map((type) => assetTypeRow(type, counts.get(type.id) ?? 0));
};

const text = (value: string | number | null): string => value?.toString() ?? "";

/** The form of an equipment as text, for the edit dialog. */
export const equipmentFormValues = (e: Equipment): EquipmentFormValues => ({
  internalCode: e.internalCode,
  supplierId: e.supplierId,
  assetTypeId: e.assetTypeId,
  brand: text(e.brand),
  model: text(e.model),
  year: text(e.year),
  serialNumber: text(e.serialNumber),
  batteryQuantity: text(e.batteryQuantity),
  observations: text(e.observations),
});

const brandModel = (e: Equipment): string | null => {
  const joined = [e.brand, e.model].filter((part) => part !== null).join(" ");
  return joined === "" ? null : joined;
};

type Names = ReadonlyMap<string, string>;

const stateOf = (item: EquipmentListItem): EquipmentState => item.assignment?.kind ?? "unassigned";

const placeOf = (item: EquipmentListItem, operations: Names, sites: Names) => ({
  state: stateOf(item),
  operationId: item.assignment?.operationId ?? null,
  operationName: operations.get(item.assignment?.operationId ?? "") ?? null,
  siteName: sites.get(item.assignment?.siteId ?? "") ?? null,
});

const equipmentRow = (item: EquipmentListItem, operations: Names, sites: Names): EquipmentRow => ({
  id: item.id,
  internalCode: item.internalCode,
  supplierName: item.supplier.name,
  assetTypeName: item.assetType.name,
  ...placeOf(item, operations, sites),
  brandModel: brandModel(item),
  year: item.year,
  serialNumber: item.serialNumber,
  batteryQuantity: item.batteryQuantity,
  observations: item.observations,
  archived: item.archivedAt !== null,
  form: equipmentFormValues(item),
});

const namesOf = (options: readonly Option[]): Names => new Map(options.map((option) => [option.id, option.name]));

/** The list items already carry the supplier and asset type names; operation and site come from `places`. */
export const buildEquipmentRows = (items: readonly EquipmentListItem[], places: Places): EquipmentRow[] => {
  const operations = namesOf(places.operations);
  const sites = namesOf(places.sites);
  return items.map((item) => equipmentRow(item, operations, sites));
};

const byName = (a: Option, b: Option): number => a.name.localeCompare(b.name, "es");

const uniqueOptions = (options: readonly Option[]): Option[] =>
  [...new Map(options.map((option) => [option.id, option])).values()].sort(byName);

/** Supplier filter options for a reader who cannot read the catalog: the suppliers of the visible equipment. */
export const supplierNamesOf = (items: readonly EquipmentListItem[]): Option[] =>
  uniqueOptions(items.map((item) => ({ id: item.supplier.id, name: item.supplier.name })));

/** The same for asset types. */
export const assetTypeNamesOf = (items: readonly EquipmentListItem[]): Option[] =>
  uniqueOptions(items.map((item) => ({ id: item.assetType.id, name: item.assetType.name })));

/** Operations that are not archived: the options of the operation filter. */
export const operationOptions = (operations: readonly (Option & { readonly archivedAt: Date | null })[]): Option[] =>
  operations.filter((operation) => operation.archivedAt === null).map(({ id, name }) => ({ id, name }));

const activeOptions = (rows: readonly (Supplier | AssetType)[]): Option[] =>
  rows.filter((row) => row.archivedAt === null).map((row) => ({ id: row.id, name: row.name }));

/** Only active suppliers can receive equipment. */
export const supplierOptions = (suppliers: readonly Supplier[]): Option[] => activeOptions(suppliers);

/** Only active asset types can classify equipment. */
export const assetTypeOptions = (types: readonly AssetType[]): Option[] => activeOptions(types);

/** A new equipment needs at least one active supplier and one active asset type. */
export const canCreateEquipment = (suppliers: readonly Option[], types: readonly Option[]): boolean =>
  suppliers.length > 0 && types.length > 0;

/** The link of the toggle: it leads to the other view. */
export const fleetToggleHref = (showingArchived: boolean): string => (showingArchived ? "/fleet" : "/fleet?archived=1");

export type FleetTab = "equipment" | "suppliers" | "asset-types";

const TABS: readonly FleetTab[] = ["equipment", "suppliers", "asset-types"];

type Raw = string | readonly string[] | undefined;

/** An unknown or repeated tab value falls back to the equipment tab. */
export const parseFleetTab = (raw: Raw): FleetTab => TABS.find((tab) => tab === raw) ?? "equipment";

export type EquipmentFilters = {
  readonly q: string;
  readonly supplierId: string | null;
  readonly typeId: string | null;
  readonly operationId: string | null;
  readonly state: EquipmentState | null;
};

const STATES: readonly EquipmentState[] = ["active", "spare", "unassigned"];

/** An unknown or repeated state value is ignored. */
export const parseEquipmentState = (raw: Raw): EquipmentState | null => STATES.find((state) => state === raw) ?? null;

const searchable = (row: EquipmentRow): string =>
  nameKey([row.internalCode, row.brandModel, row.serialNumber, row.supplierName, row.assetTypeName].filter((part) => part !== null).join(" "));

const matchesFilters = (row: EquipmentRow, filters: EquipmentFilters): boolean =>
  (filters.supplierId === null || row.form.supplierId === filters.supplierId) &&
  (filters.typeId === null || row.form.assetTypeId === filters.typeId) &&
  (filters.operationId === null || row.operationId === filters.operationId) &&
  (filters.state === null || (!row.archived && row.state === filters.state));

/** Text search (ignoring case and accents) plus the supplier, asset type, operation and state filters. */
export const filterEquipment = (rows: readonly EquipmentRow[], filters: EquipmentFilters): EquipmentRow[] => {
  const key = nameKey(filters.q);
  return rows.filter((row) => matchesFilters(row, filters) && (key === "" || searchable(row).includes(key)));
};

/** A filter id that is not among the options is ignored. */
export const knownId = (raw: Raw, options: readonly Option[]): string | null =>
  typeof raw === "string" && options.some((option) => option.id === raw) ? raw : null;

export const PAGE_SIZE = 20;

export const parsePage = (raw: Raw): number => {
  const page = typeof raw === "string" && /^\d+$/u.test(raw) ? Number(raw) : 1;
  return page < 1 ? 1 : page;
};

export type Page<T> = {
  readonly items: T[];
  readonly page: number;
  readonly pages: number;
  readonly total: number;
  readonly from: number;
  readonly to: number;
};

/** Slices one page; an out-of-range page is clamped. `from` and `to` are 1-based and 0 when empty. */
export const paginate = <T>(items: readonly T[], requested: number): Page<T> => {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pages);
  const start = (page - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  return { items: slice, page, pages, total: items.length, from: slice.length === 0 ? 0 : start + 1, to: start + slice.length };
};

/** Up to five page numbers around the current page, for the pagination links. */
export const pageWindow = (page: number, pages: number): number[] => {
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  const end = Math.min(pages, start + 4);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
};

export type FleetQuery = {
  readonly tab?: FleetTab;
  readonly archived?: boolean;
  readonly q?: string;
  readonly supplierId?: string | null;
  readonly typeId?: string | null;
  readonly operationId?: string | null;
  readonly state?: EquipmentState | null;
  readonly page?: number;
};

/** A fleet link with only the non-default params, so the other filters survive navigation. */
export const fleetHref = (query: FleetQuery): string => {
  const params = new URLSearchParams();
  if (query.tab !== undefined && query.tab !== "equipment") params.set("tab", query.tab);
  if (query.archived === true) params.set("archived", "1");
  if (query.q !== undefined && query.q.trim() !== "") params.set("q", query.q);
  if (query.supplierId) params.set("supplier", query.supplierId);
  if (query.typeId) params.set("type", query.typeId);
  if (query.operationId) params.set("operation", query.operationId);
  if (query.state) params.set("state", query.state);
  if (query.page !== undefined && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text === "" ? "/fleet" : `/fleet?${text}`;
};

/** The rows of a list result, or none when it failed: the board then shows blank names instead of breaking. */
export const listOrEmpty = <T>(result: { readonly ok: true; readonly value: readonly T[] } | { readonly ok: false; readonly error: unknown }): readonly T[] =>
  result.ok ? result.value : [];
