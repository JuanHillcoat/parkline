import { err, ok, type Result } from "../../shared/domain/result";
import {
  InvalidDateError,
  InvalidShiftsError,
  ShiftProfileNotAfterError,
  ShiftProfileOverlapError,
} from "./errors";

export const SHIFT_OPTIONS = ["1", "2", "3", "24h"] as const;
export type Shifts = (typeof SHIFT_OPTIONS)[number];

/**
 * One version of an operation's shift profile (D6). Dates are plain ISO dates
 * (YYYY-MM-DD) with no timezone; `validTo` null means the version is open.
 */
export type ShiftProfile = {
  readonly operationId: string;
  readonly shifts: Shifts;
  readonly validFrom: string;
  readonly validTo: string | null;
};

export type NewShiftProfile = Pick<ShiftProfile, "operationId" | "shifts" | "validFrom">;

const DAY_MS = 86_400_000;

export const parseShifts = (raw: string): Result<Shifts, InvalidShiftsError> => {
  const found = SHIFT_OPTIONS.find((option) => option === raw);
  return found ? ok(found) : err(new InvalidShiftsError(`Shifts must be one of ${SHIFT_OPTIONS.join(", ")}`));
};

/** A real calendar date written as YYYY-MM-DD. */
export const parseIsoDate = (raw: string): Result<string, InvalidDateError> => {
  const time = /^\d{4}-\d{2}-\d{2}$/u.test(raw) ? Date.parse(`${raw}T00:00:00Z`) : Number.NaN;
  const real = !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === raw;
  return real ? ok(raw) : err(new InvalidDateError("The date must be a real date as YYYY-MM-DD"));
};

const dayBefore = (isoDate: string): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

const closeOpen = (version: ShiftProfile, validFrom: string): ShiftProfile =>
  version.validTo === null ? { ...version, validTo: dayBefore(validFrom) } : version;

/**
 * Appends a version that starts at `validFrom` and closes the open one the day
 * before, so the history has no gap and no overlap. Dates compare as strings
 * because ISO dates sort lexicographically.
 */
export const setShiftProfile = (
  existing: readonly ShiftProfile[],
  input: NewShiftProfile,
): Result<ShiftProfile[], InvalidDateError | ShiftProfileNotAfterError | ShiftProfileOverlapError> => {
  const from = parseIsoDate(input.validFrom);
  if (!from.ok) return from;
  const open = existing.find((version) => version.validTo === null);
  if (open && open.validFrom >= input.validFrom) {
    return err(new ShiftProfileNotAfterError("The new version must start after the open version starts"));
  }
  const closed = existing.filter((version) => version.validTo !== null);
  if (closed.some((version) => (version.validTo ?? "") >= input.validFrom)) {
    return err(new ShiftProfileOverlapError("The new version overlaps an earlier version"));
  }
  const created: ShiftProfile = { ...input, validTo: null };
  return ok([...existing.map((version) => closeOpen(version, input.validFrom)), created]);
};
