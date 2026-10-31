import { shiftDay, type Day } from "./day";
import type { EffectiveReading } from "./entities";
import { hoursBetween } from "./readings";

const pad = (value: number): string => String(value).padStart(2, "0");

/** The last day of the 1-based `month` of `year`. */
const lastDayOf = (year: number, month: number): Day =>
  shiftDay(month === 12 ? `${String(year + 1)}-01-01` : `${String(year)}-${pad(month + 1)}-01`, -1);

/**
 * The hours (or km) of one calendar month, through `hoursBetween`. The window opens on the last day of the
 * previous month, so a reading taken on the 1st counts in its own month and the twelve months of a year add up
 * to the growth of the year.
 */
const totalOf = (segments: readonly (readonly EffectiveReading[])[], year: number, month: number): number => {
  const from = shiftDay(`${String(year)}-${pad(month)}-01`, -1);
  return hoursBetween(segments, from, lastDayOf(year, month)).hours;
};

/** Issue 60 D4: the total of each month of `year`, January to December (UTC days). */
export const monthlyTotals = (segments: readonly (readonly EffectiveReading[])[], year: number): readonly number[] =>
  Array.from({ length: 12 }, (_, index) => totalOf(segments, year, index + 1));

/** Issue 60 D3: the total of the calendar month that contains `day`. */
export const monthTotal = (segments: readonly (readonly EffectiveReading[])[], day: Day): number =>
  totalOf(segments, Number(day.slice(0, 4)), Number(day.slice(5, 7)));
