import { err, ok, type Result } from "../../shared/domain/result";
import { compareDays, type Day } from "./day";
import type { EffectiveReading, MeterReading } from "./entities";
import { ReadingOutOfOrderError } from "./errors";
import { fromTenths } from "./values";

/** The original reading a row ends up correcting, following `correctsId` through the chain. */
export const rootOf = (rows: readonly MeterReading[], id: string): string => {
  let current = rows.find((row) => row.id === id);
  while (current?.kind === "correction" && current.correctsId !== null) {
    const parent: string = current.correctsId;
    const next = rows.find((row) => row.id === parent);
    if (next === undefined) break;
    current = next;
  }
  return current?.id ?? id;
};

/**
 * The timeline of one meter: its original readings ordered by day (ties keep insertion order, which is
 * creation order), each with the value of its latest correction. `rows` are in insertion order.
 */
export const effectiveReadings = (rows: readonly MeterReading[]): readonly EffectiveReading[] => {
  const latest = new Map<string, number>();
  for (const row of rows) if (row.kind === "correction") latest.set(rootOf(rows, row.id), row.valueTenths);
  return rows
    .filter((row) => row.kind !== "correction")
    .map((row) => ({ id: row.id, meterId: row.meterId, readOn: row.readOn, kind: row.kind, valueTenths: latest.get(row.id) ?? row.valueTenths }))
    .sort((a, b) => compareDays(a.readOn, b.readOn));
};

const show = (reading: EffectiveReading): string => `${String(fromTenths(reading.valueTenths))} on ${reading.readOn}`;

const within = (
  prev: EffectiveReading | undefined,
  next: EffectiveReading | undefined,
  tenths: number,
): Result<void, ReadingOutOfOrderError> => {
  if (prev !== undefined && tenths < prev.valueTenths) {
    return err(
      new ReadingOutOfOrderError(
        `The value is lower than the previous reading (${show(prev)}); if the meter was changed, record a meter replacement instead`,
      ),
    );
  }
  if (next !== undefined && tenths > next.valueTenths) {
    return err(new ReadingOutOfOrderError(`The value is higher than the following reading (${show(next)})`));
  }
  return ok(undefined);
};

/**
 * D3: a new reading goes after every reading of its day or earlier (it is the newest by creation), so
 * its neighbors are the last one on or before the day and the first one after it. `timeline` is the
 * effective readings of the OPEN meter.
 */
export const checkNewReading = (
  timeline: readonly EffectiveReading[],
  day: Day,
  tenths: number,
): Result<void, ReadingOutOfOrderError> => {
  const index = timeline.filter((reading) => compareDays(reading.readOn, day) <= 0).length;
  return within(timeline[index - 1], timeline[index], tenths);
};

/** D4: a corrected reading keeps its place, so only its current neighbors constrain the new value. */
export const checkCorrection = (
  timeline: readonly EffectiveReading[],
  readingId: string,
  tenths: number,
): Result<void, ReadingOutOfOrderError> => {
  const index = timeline.findIndex((reading) => reading.id === readingId);
  return within(timeline[index - 1], timeline[index + 1], tenths);
};

export type HoursResult = { readonly hours: number; readonly incomplete: boolean };

const lastOnOrBefore = (timeline: readonly EffectiveReading[], day: Day): EffectiveReading | undefined =>
  timeline.filter((reading) => compareDays(reading.readOn, day) <= 0).at(-1);

const endsOnOrBefore = (timeline: readonly EffectiveReading[], day: Day): boolean => {
  const last = timeline.at(-1);
  return last?.kind === "replacement_close" && compareDays(last.readOn, day) <= 0;
};

const overlaps = (timeline: readonly EffectiveReading[], from: Day, to: Day): boolean => {
  const first = timeline[0];
  return first !== undefined && compareDays(first.readOn, to) <= 0 && !endsOnOrBefore(timeline, from);
};

/** Tenths of one overlapping segment, or null with fewer than two usable readings. */
const segmentDelta = (timeline: readonly EffectiveReading[], from: Day, to: Day): number | null => {
  const base = lastOnOrBefore(timeline, from) ?? timeline[0];
  const end = lastOnOrBefore(timeline, to);
  return base === undefined || end === undefined || base.id === end.id ? null : end.valueTenths - base.valueTenths;
};

/**
 * D6: the hours (or km) between two days, summed per meter segment. Each segment contributes the effective
 * value at `to` minus the effective value at `from` (the last reading on or before each day; when the
 * segment opens after `from`, its first reading is the baseline). A segment with fewer than two usable
 * readings contributes nothing and the result is `incomplete`, as is a period no segment covers.
 * `segments` are the effective timelines of the equipment's meters, oldest meter first.
 */
export const hoursBetween = (segments: readonly (readonly EffectiveReading[])[], from: Day, to: Day): HoursResult => {
  const deltas = segments.filter((segment) => overlaps(segment, from, to)).map((segment) => segmentDelta(segment, from, to));
  const sum = deltas.reduce<number>((total, delta) => total + (delta ?? 0), 0);
  return { hours: fromTenths(sum), incomplete: deltas.length === 0 || deltas.includes(null) };
};
