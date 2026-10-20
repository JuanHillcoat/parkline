import { MAX_NAME_LENGTH, parseNormalizedText } from "../../shared/domain/catalog-name";
import { err, mapErr, ok, type Result } from "../../shared/domain/result";
import {
  InvalidBatteryQuantityError,
  InvalidInternalCodeError,
  InvalidMeterKindError,
  InvalidNameError,
  InvalidPreventiveIntervalError,
  InvalidTextError,
  InvalidYearError,
} from "./errors";

export const MAX_INTERNAL_CODE_LENGTH = 40;
export const MAX_PREVENTIVE_INTERVAL_HOURS = 10000;
export const MIN_YEAR = 1950;
export const MAX_BATTERY_QUANTITY = 4;
export const MAX_BRAND_LENGTH = 120;
export const MAX_MODEL_LENGTH = 120;
export const MAX_SERIAL_NUMBER_LENGTH = 60;
export const MAX_OBSERVATIONS_LENGTH = 500;

export const METER_KINDS = ["hours", "km", "none"] as const;
export type MeterKind = (typeof METER_KINDS)[number];

/** The stored name: the shared normalization (uppercase, collapsed whitespace), at most 120 characters. */
export const parseName = (raw: string): Result<string, InvalidNameError> =>
  mapErr(parseNormalizedText(raw, MAX_NAME_LENGTH, "name"), (message) => new InvalidNameError(message));

/** The stored internal code ("C-043", "9001"): normalized like a name, at most 40 characters. */
export const parseInternalCode = (raw: string): Result<string, InvalidInternalCodeError> =>
  mapErr(
    parseNormalizedText(raw, MAX_INTERNAL_CODE_LENGTH, "internal code"),
    (message) => new InvalidInternalCodeError(message),
  );

export const parseMeterKind = (raw: string): Result<MeterKind, InvalidMeterKindError> =>
  (METER_KINDS as readonly string[]).includes(raw) ? ok(raw as MeterKind) : err(new InvalidMeterKindError());

/** A positive integer up to 10000 (hours or km between preventive services), or null when not set. */
export const parsePreventiveInterval = (raw: number | null): Result<number | null, InvalidPreventiveIntervalError> => {
  if (raw === null) return ok(null);
  const valid = Number.isInteger(raw) && raw >= 1 && raw <= MAX_PREVENTIVE_INTERVAL_HOURS;
  const message = `The preventive interval is a whole number from 1 to ${String(MAX_PREVENTIVE_INTERVAL_HOURS)}`;
  return valid ? ok(raw) : err(new InvalidPreventiveIntervalError(message));
};

/** An integer from 1950 to the current year plus one, or null. The caller injects the current year. */
export const parseYear = (raw: number | null, currentYear: number): Result<number | null, InvalidYearError> => {
  if (raw === null) return ok(null);
  const valid = Number.isInteger(raw) && raw >= MIN_YEAR && raw <= currentYear + 1;
  return valid ? ok(raw) : err(new InvalidYearError(`The year is a whole number from ${String(MIN_YEAR)} to ${String(currentYear + 1)}`));
};

/** An integer from 0 to 4 (batteries of an electric unit), or null. */
export const parseBatteryQuantity = (raw: number | null): Result<number | null, InvalidBatteryQuantityError> => {
  if (raw === null) return ok(null);
  const valid = Number.isInteger(raw) && raw >= 0 && raw <= MAX_BATTERY_QUANTITY;
  const message = `The battery quantity is a whole number from 0 to ${String(MAX_BATTERY_QUANTITY)}`;
  return valid ? ok(raw) : err(new InvalidBatteryQuantityError(message));
};

/** Optional free text: trimmed, blank becomes null, bounded. `field` names the offending input. */
export const parseOptionalText = (
  raw: string | null,
  maxLength: number,
  field: string,
): Result<string | null, InvalidTextError> => {
  const text = raw === null ? "" : raw.trim();
  if (text === "") return ok(null);
  return text.length > maxLength
    ? err(new InvalidTextError(`The ${field} has at most ${String(maxLength)} characters`, field))
    : ok(text);
};
