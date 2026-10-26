import { field } from "./action-state";
import { optionalText } from "./fleet-form";

/**
 * A meter value arrives as text: digits with an optional decimal part, written with a dot or a comma.
 * Anything else, including an empty text, becomes NaN, which the use case rejects with
 * `invalid_reading_value` (the number of decimals is checked there).
 */
export const readingNumber = (raw: string): number => {
  const text = raw.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/u.test(text) ? Number(text) : Number.NaN;
};

const day = (form: FormData, name: string): string => field(form, name).trim();

/** A new reading. The reason is optional: blank is "not set". */
export const recordFields = (form: FormData) => ({
  equipmentId: field(form, "equipmentId"),
  day: day(form, "day"),
  value: readingNumber(field(form, "value")),
  reason: optionalText(field(form, "reason")),
});

export const correctReadingFields = (form: FormData) => ({
  equipmentId: field(form, "equipmentId"),
  readingId: field(form, "readingId"),
  value: readingNumber(field(form, "value")),
  reason: field(form, "reason"),
});

export const replaceMeterFields = (form: FormData) => ({
  equipmentId: field(form, "equipmentId"),
  day: day(form, "day"),
  finalValue: readingNumber(field(form, "finalValue")),
  initialValue: readingNumber(field(form, "initialValue")),
  reason: field(form, "reason"),
});

/**
 * The optional first reading of a new equipment ("Horómetro"). Nothing is sent unless a value was typed; then
 * the day travels with it: the "Desde el día" of the registration, shared with the assignment. A value that is not a number is sent as NaN so the use case answers with its typed error.
 */
export const initialReadingOnCreate = (form: FormData) => {
  const raw = field(form, "readingValue").trim();
  if (raw === "") return undefined;
  return { day: day(form, "day"), value: readingNumber(raw) };
};
