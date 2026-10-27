import { err, ok, type Result } from "../../shared/domain/result";
import { InvalidDayError } from "./errors";

/**
 * A calendar day as `YYYY-MM-DD`, with no time and no timezone. Minimal duplicate of the fleet module's
 * day helpers (modules never import each other); hoist both into the shared kernel when a third user appears.
 */
export type Day = string;

const SHAPE = /^\d{4}-\d{2}-\d{2}$/;

const toUtc = (day: Day): Date => new Date(`${day}T00:00:00Z`);

const format = (date: Date): Day => date.toISOString().slice(0, 10);

/** The day when it is a real calendar date (no 2026-02-30); `field` names the input in the error. */
export const parseDay = (raw: string, field = "day"): Result<Day, InvalidDayError> => {
  const valid = SHAPE.test(raw) && !Number.isNaN(toUtc(raw).getTime()) && format(toUtc(raw)) === raw;
  return valid ? ok(raw) : err(new InvalidDayError("The day is a date written as YYYY-MM-DD", field));
};

/** Negative when `a` is before `b`, zero when equal, positive when after. */
export const compareDays = (a: Day, b: Day): number => (a < b ? -1 : a > b ? 1 : 0);

/** The day `count` calendar days after `day` (negative for before). */
export const shiftDay = (day: Day, count: number): Day => format(new Date(toUtc(day).getTime() + count * 86_400_000));

/** The UTC calendar day of an instant: what "today" means for the injected clock. */
export const dayOf = (instant: Date): Day => format(instant);
