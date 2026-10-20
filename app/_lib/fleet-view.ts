import type { AssetType, Equipment, Supplier } from "../../src/fleet/domain/entities";
import type { MeterKind } from "../../src/fleet/domain/values";
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

/** The names are null when the supplier or the asset type is not in the visible lists. */
export type EquipmentRow = {
  readonly id: string;
  readonly internalCode: string;
  readonly supplierName: string | null;
  readonly assetTypeName: string | null;
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

const equipmentRow = (e: Equipment, suppliers: Names, types: Names): EquipmentRow => ({
  id: e.id,
  internalCode: e.internalCode,
  supplierName: suppliers.get(e.supplierId) ?? null,
  assetTypeName: types.get(e.assetTypeId) ?? null,
  brandModel: brandModel(e),
  year: e.year,
  serialNumber: e.serialNumber,
  batteryQuantity: e.batteryQuantity,
  observations: e.observations,
  archived: e.archivedAt !== null,
  form: equipmentFormValues(e),
});

export const buildEquipmentRows = (
  equipment: readonly Equipment[],
  suppliers: readonly Supplier[],
  types: readonly AssetType[],
): EquipmentRow[] => {
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));
  const typeNames = new Map(types.map((type) => [type.id, type.name]));
  return equipment.map((e) => equipmentRow(e, supplierNames, typeNames));
};

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
