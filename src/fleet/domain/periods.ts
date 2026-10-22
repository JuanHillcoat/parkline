import { compareDays, type Day } from "./day";

/** A span of days, both ends inclusive. A null end is open. */
export type Period = { readonly validFrom: Day; readonly validTo: Day | null };

const startsAfter = (a: Period, b: Period): boolean => b.validTo !== null && compareDays(a.validFrom, b.validTo) > 0;

/** Two periods overlap when they share at least one day; contiguous periods (the next day) do not. */
export const periodsOverlap = (a: Period, b: Period): boolean => !startsAfter(a, b) && !startsAfter(b, a);

/** True when the candidate overlaps any of the periods of the same equipment. */
export const overlapsAny = (candidate: Period, others: readonly Period[]): boolean =>
  others.some((other) => periodsOverlap(candidate, other));
