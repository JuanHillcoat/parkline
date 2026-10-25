import { err, ok, type Result } from "../../shared/domain/result";
import { InvalidReadingValueError } from "./errors";

/** The largest reading, 9,999,999.9, as tenths. */
export const MAX_READING_TENTHS = 99_999_999;

/** Tolerance for the binary noise of `0.1 + 0.2`: far below one tenth, far above double rounding error. */
const NOISE = 1e-6;

/**
 * A reading value as an integer number of tenths (no floating point in storage or in comparisons):
 * a finite number from 0 to 9,999,999.9 with at most one decimal.
 */
export const parseReadingValue = (raw: number, field = "value"): Result<number, InvalidReadingValueError> => {
  const scaled = raw * 10;
  const tenths = Math.round(scaled);
  const valid = Number.isFinite(raw) && Math.abs(scaled - tenths) < NOISE && tenths >= 0 && tenths <= MAX_READING_TENTHS;
  return valid ? ok(tenths === 0 ? 0 : tenths) : err(new InvalidReadingValueError(field));
};

/** Tenths back to the number people read and type. */
export const fromTenths = (tenths: number): number => tenths / 10;
