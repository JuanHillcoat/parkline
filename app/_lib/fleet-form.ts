import { field } from "./action-state";

/**
 * Number inputs arrive as text. Blank means "not set" (null); a whole number is parsed;
 * anything else becomes NaN, which the domain rejects with its typed error.
 */
export const optionalInteger = (raw: string): number | null => {
  const text = raw.trim();
  if (text === "") return null;
  return /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
};

/** Blank optional text is "not set" (null); the domain trims and bounds the rest. */
export const optionalText = (raw: string): string | null => (raw.trim() === "" ? null : raw);

/** The editable fields of an asset type. A disabled interval input is not submitted: it reads as null. */
export const assetTypeFields = (form: FormData) => ({
  name: field(form, "name"),
  meterKind: field(form, "meterKind"),
  preventiveIntervalHours: optionalInteger(field(form, "preventiveIntervalHours")),
});

/** The editable fields of an equipment. Authorization never depends on them. */
export const equipmentFields = (form: FormData) => ({
  supplierId: field(form, "supplierId"),
  assetTypeId: field(form, "assetTypeId"),
  internalCode: field(form, "internalCode"),
  brand: optionalText(field(form, "brand")),
  model: optionalText(field(form, "model")),
  year: optionalInteger(field(form, "year")),
  serialNumber: optionalText(field(form, "serialNumber")),
  batteryQuantity: optionalInteger(field(form, "batteryQuantity")),
  observations: optionalText(field(form, "observations")),
});
