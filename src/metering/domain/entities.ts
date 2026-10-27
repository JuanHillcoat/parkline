import type { Day } from "./day";

export type MeterKind = "hours" | "km";

export const READING_KINDS = ["reading", "correction", "replacement_close", "replacement_open"] as const;
export type ReadingKind = (typeof READING_KINDS)[number];

/** One physical meter of an equipment. At most one is open (`closedOn` null) per equipment. */
export type Meter = {
  readonly id: string;
  readonly tenantId: string;
  readonly equipmentId: string;
  readonly kind: MeterKind;
  readonly openedOn: Day;
  readonly closedOn: Day | null;
  /** Value of the first reading or of the replacement that opened the meter, in tenths. */
  readonly initialValueTenths: number;
};

/**
 * An immutable event. A correction never edits the reading it corrects: it references the original
 * (`correctsId`) and carries the day of the original; the effective value is the latest correction.
 */
export type MeterReading = {
  readonly id: string;
  readonly tenantId: string;
  readonly meterId: string;
  readonly readOn: Day;
  readonly valueTenths: number;
  readonly kind: ReadingKind;
  readonly correctsId: string | null;
  readonly reason: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
};

/** A reading with the value that counts after its corrections; corrections themselves are not in the timeline. */
export type EffectiveReading = {
  readonly id: string;
  readonly meterId: string;
  readonly readOn: Day;
  readonly kind: ReadingKind;
  readonly valueTenths: number;
};
