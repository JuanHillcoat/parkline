import type { ImageChange } from "../../src/fleet/application/equipment-image";
import type { AssignmentTarget } from "../../src/fleet/application/assignment-support";
import { ValidationError, type DomainError } from "../../src/shared/domain/domain-error";
import { err, type Result } from "../../src/shared/domain/result";
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

/** The editable fields of an equipment. Brand and model are required: the domain rejects a blank one. */
export const equipmentFields = (form: FormData) => ({
  supplierId: field(form, "supplierId"),
  assetTypeId: field(form, "assetTypeId"),
  internalCode: field(form, "internalCode"),
  brand: field(form, "brand"),
  model: field(form, "model"),
  year: optionalInteger(field(form, "year")),
  serialNumber: optionalText(field(form, "serialNumber")),
  batteryKind: field(form, "batteryKind").trim(),
  batteryQuantity: optionalInteger(field(form, "batteryQuantity")),
  observations: optionalText(field(form, "observations")),
});

/**
 * Where an equipment goes: the `operationId` of the form, else its `siteId` (a spare of that site, ADR-0013).
 * Neither chosen is `undefined`.
 */
export const targetOf = (form: FormData): AssignmentTarget | undefined => {
  const operationId = field(form, "operationId").trim();
  if (operationId !== "") return { operationId };
  const siteId = field(form, "siteId").trim();
  return siteId === "" ? undefined : { siteId };
};

/**
 * The optional first assignment of a new equipment. Nothing is sent unless an operation or a site (the
 * equipment is born a spare of it) was chosen; then the day ("Fecha de ingreso") and the reason travel with it. The
 * reason is the Observaciones of the form: blank is "not set", and only a past day makes it mandatory.
 */
export const assignmentOnCreate = (form: FormData) => {
  const target = targetOf(form);
  if (target === undefined) return undefined;
  return { target, day: field(form, "day").trim(), reason: optionalText(field(form, "observations")) };
};

/** The registration asks for its reason in Observaciones, so the generic "motivo" wording would confuse. */
class RegistrationDayInPastError extends ValidationError {
  readonly code: string = "registration_day_in_past";

  constructor() {
    super("The reason of a past day is written in Observaciones", "observations");
  }
}

/** Rewords the typed `reason_required` of a registration so the message names Observaciones; anything else passes. */
export const registrationWording = <T>(result: Result<T, DomainError>): Result<T, DomainError> =>
  result.ok || result.error.code !== "reason_required" ? result : err(new RegistrationDayInPastError());

/**
 * The bytes of an uploaded file. A file input left empty arrives as an empty file whose name the framework may
 * rewrite, so an empty file only counts as chosen when the form says so (`imageChosen`, set by the image field
 * when a file is picked); a chosen file with no content stays empty, so the domain answers `image_empty`.
 */
const uploadedBytes = async (form: FormData, name: string): Promise<Uint8Array | null> => {
  const file = form.get(name);
  if (!(file instanceof File)) return null;
  if (file.size === 0 && field(form, "imageChosen") !== "1") return null;
  return new Uint8Array(await file.arrayBuffer());
};

/** The image of a new equipment: the chosen file, or null for none. */
export const newImage = (form: FormData): Promise<Uint8Array | null> => uploadedBytes(form, "image");

/**
 * What an edit does with the image: `imageAction` is keep (default, also when missing or unknown), replace or
 * remove. A replace without a file is an empty replacement, which the domain rejects with `image_empty`.
 */
export const imageChange = async (form: FormData): Promise<ImageChange> => {
  const action = field(form, "imageAction");
  if (action === "remove") return { action: "remove" };
  if (action !== "replace") return { action: "keep" };
  return { action: "replace", bytes: (await uploadedBytes(form, "image")) ?? new Uint8Array(0) };
};
