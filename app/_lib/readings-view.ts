import type { EquipmentReadings, ReadingRow } from "../../src/metering/application/use-cases/list-equipment-readings";
import { copy } from "./copy";
import { formatDay } from "./equipment-detail-view";

const t = copy.fleet.detail.readings;
const NONE = copy.fleet.noValue;

export type MeterKindName = "hours" | "km" | "none";

/**
 * A meter value as people read it: thousands with a dot, one decimal with a comma, then the unit
 * (`1.234,5 h`). Text only, so the server and the tests agree whatever the locale of the machine.
 */
export const formatReading = (value: number, kind: "hours" | "km"): string => {
  const [whole = "0", decimal = "0"] = value.toFixed(1).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  return `${grouped},${decimal} ${t.units[kind]}`;
};

/** The value as the correction dialog shows it first: a plain number with a dot, so it can be edited. */
export const editableValue = (value: number): string => value.toFixed(1);

export type ReadingActions = { readonly load: boolean; readonly correct: boolean; readonly replace: boolean };

type ActionContext = {
  readonly canWrite: boolean;
  readonly canCorrect: boolean;
  readonly archived: boolean;
  readonly meterKind: MeterKindName;
};

/**
 * The buttons of the Lecturas tab (D7): loading needs `reading.write`; correcting and replacing the meter
 * need `reading.correct`; an archived equipment or one without a meter gets none. Replacing needs an open
 * meter to close, so it also waits for the first reading. The use cases authorize again.
 */
export const readingActions = (context: ActionContext, hasMeter: boolean): ReadingActions => {
  const live = !context.archived && context.meterKind !== "none";
  return {
    load: live && context.canWrite,
    correct: live && context.canCorrect,
    replace: live && context.canCorrect && hasMeter,
  };
};

export type WhoNames = {
  readonly selfId: string;
  readonly selfName: string;
  /** Display names by user id, for the actors allowed to list users; empty otherwise. */
  readonly names: ReadonlyMap<string, string>;
};

/** Who loaded a row: the viewer sees "Tú" for their own rows, a listed name for others, a dash otherwise. */
export const whoLabel = (userId: string, who: WhoNames): string => {
  if (userId === who.selfId) return t.you;
  return who.names.get(userId) ?? NONE;
};

export type ReadingViewRow = {
  readonly id: string;
  readonly day: string;
  readonly value: string;
  readonly kindLabel: string;
  readonly kind: ReadingRow["kind"];
  readonly who: string;
  readonly reason: string;
  readonly superseded: boolean;
  /** The value and the day the correction dialog opens with. */
  readonly form: { readonly value: string; readonly day: string };
};

const readingRow = (row: ReadingRow, kind: "hours" | "km", who: WhoNames): ReadingViewRow => ({
  id: row.id,
  day: formatDay(row.readOn),
  value: formatReading(row.value, kind),
  kindLabel: t.kinds[row.kind],
  kind: row.kind,
  who: whoLabel(row.createdBy, who),
  reason: row.reason ?? NONE,
  superseded: row.superseded,
  form: { value: editableValue(row.value), day: formatDay(row.readOn) },
});

export type ReadingsView =
  | { readonly kind: "none" }
  | {
      readonly kind: "meter";
      readonly unit: "hours" | "km";
      readonly meter: { readonly opened: string; readonly label: string } | null;
      readonly hours: { readonly text: string; readonly incomplete: boolean };
      readonly rows: readonly ReadingViewRow[];
    };

/** What the Lecturas tab shows. The history keeps the order of the use case (newest first). */
export const buildReadingsView = (readings: EquipmentReadings, who: WhoNames): ReadingsView => {
  if (readings.meterKind === "none") return { kind: "none" };
  const unit = readings.meterKind;
  return {
    kind: "meter",
    unit,
    meter: readings.meter === null ? null : { opened: formatDay(readings.meter.openedOn), label: copy.fleet.meter[unit] },
    hours: { text: formatReading(readings.hoursLast30Days.hours, unit), incomplete: readings.hoursLast30Days.incomplete },
    rows: readings.history.map((row) => readingRow(row, unit, who)),
  };
};

/** The row of the information card: the last effective reading with its day, or a dash. Nothing without a meter. */
export const lastReadingRow = (readings: EquipmentReadings | null): { label: string; value: string } | null => {
  if (readings === null || readings.meterKind === "none") return null;
  const last = readings.lastReading;
  const value = last === null ? NONE : `${formatReading(last.value, readings.meterKind)} (${formatDay(last.readOn)})`;
  return { label: copy.fleet.detail.info.lastReading, value };
};
