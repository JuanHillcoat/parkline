import { andThen, err, map, ok, type Result } from "../../shared/domain/result";
import {
  PreventiveIntervalNotAllowedError,
  type InvalidBatteryQuantityError,
  type InvalidInternalCodeError,
  type InvalidMeterKindError,
  type InvalidNameError,
  type InvalidPreventiveIntervalError,
  type InvalidTextError,
  type InvalidYearError,
} from "./errors";
import {
  MAX_BRAND_LENGTH,
  MAX_MODEL_LENGTH,
  MAX_OBSERVATIONS_LENGTH,
  MAX_SERIAL_NUMBER_LENGTH,
  parseBatteryQuantity,
  parseInternalCode,
  parseMeterKind,
  parseName,
  parseOptionalText,
  parsePreventiveInterval,
  parseRequiredText,
  parseYear,
  type MeterKind,
} from "./values";

/**
 * `archivedAt` is null while the row is active. An archived row keeps its history but owns
 * no name and no internal code (uniqueness holds among active rows only).
 */
type Archivable = { readonly archivedAt: Date | null };

export type Supplier = Archivable & { readonly id: string; readonly tenantId: string; readonly name: string };

/** What an asset type counts its preventive interval in; `none` has no meter and no interval. */
export type AssetType = Archivable & {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly meterKind: MeterKind;
  readonly preventiveIntervalHours: number | null;
};

/** A piece of equipment. Its internal code is unique per tenant and supplier among active rows. */
export type Equipment = Archivable & {
  readonly id: string;
  readonly tenantId: string;
  readonly supplierId: string;
  readonly assetTypeId: string;
  readonly internalCode: string;
  /** Required when registering or editing; rows stored before that rule may still hold null. */
  readonly brand: string | null;
  readonly model: string | null;
  readonly year: number | null;
  readonly serialNumber: string | null;
  readonly batteryQuantity: number | null;
  readonly observations: string | null;
};

type WithArchivedAt = { readonly archivedAt?: Date | null };

export type SupplierInput = Omit<Supplier, "archivedAt"> & WithArchivedAt;
/** The meter kind arrives as typed text and is parsed here. */
export type AssetTypeInput = Omit<AssetType, "archivedAt" | "meterKind"> & WithArchivedAt & { readonly meterKind: string };
export type EquipmentInput = Omit<Equipment, "archivedAt"> & WithArchivedAt;

export type AssetTypeError =
  | InvalidNameError
  | InvalidMeterKindError
  | InvalidPreventiveIntervalError
  | PreventiveIntervalNotAllowedError;

export type EquipmentError =
  | InvalidInternalCodeError
  | InvalidTextError
  | InvalidYearError
  | InvalidBatteryQuantityError;

export const createSupplier = (input: SupplierInput): Result<Supplier, InvalidNameError> =>
  map(parseName(input.name), (name) => ({ ...input, name, archivedAt: input.archivedAt ?? null }));

const intervalFor = (kind: MeterKind, interval: number | null): Result<number | null, AssetTypeError> =>
  kind === "none" && interval !== null ? err(new PreventiveIntervalNotAllowedError()) : ok(interval);

export const createAssetType = (input: AssetTypeInput): Result<AssetType, AssetTypeError> => {
  const name = parseName(input.name);
  if (!name.ok) return name;
  const kind = parseMeterKind(input.meterKind);
  if (!kind.ok) return kind;
  const interval = andThen<number | null, number | null, AssetTypeError>(
    parsePreventiveInterval(input.preventiveIntervalHours),
    (value) => intervalFor(kind.value, value),
  );
  if (!interval.ok) return interval;
  return ok({
    ...input,
    name: name.value,
    meterKind: kind.value,
    preventiveIntervalHours: interval.value,
    archivedAt: input.archivedAt ?? null,
  });
};

type TextFields = Pick<Equipment, "brand" | "model" | "serialNumber" | "observations">;

const equipmentTexts = (input: EquipmentInput): Result<TextFields, InvalidTextError> => {
  const brand = parseRequiredText(input.brand, MAX_BRAND_LENGTH, "brand");
  if (!brand.ok) return brand;
  const model = parseRequiredText(input.model, MAX_MODEL_LENGTH, "model");
  if (!model.ok) return model;
  const serialNumber = parseOptionalText(input.serialNumber, MAX_SERIAL_NUMBER_LENGTH, "serialNumber");
  if (!serialNumber.ok) return serialNumber;
  const observations = parseOptionalText(input.observations, MAX_OBSERVATIONS_LENGTH, "observations");
  if (!observations.ok) return observations;
  return ok({ brand: brand.value, model: model.value, serialNumber: serialNumber.value, observations: observations.value });
};

/** `currentYear` is injected (from the clock) so the year bound is deterministic. */
export const createEquipment = (input: EquipmentInput, currentYear: number): Result<Equipment, EquipmentError> => {
  const internalCode = parseInternalCode(input.internalCode);
  if (!internalCode.ok) return internalCode;
  const texts = equipmentTexts(input);
  if (!texts.ok) return texts;
  const year = parseYear(input.year, currentYear);
  if (!year.ok) return year;
  const batteryQuantity = parseBatteryQuantity(input.batteryQuantity);
  if (!batteryQuantity.ok) return batteryQuantity;
  return ok({
    ...input,
    ...texts.value,
    internalCode: internalCode.value,
    year: year.value,
    batteryQuantity: batteryQuantity.value,
    archivedAt: input.archivedAt ?? null,
  });
};
