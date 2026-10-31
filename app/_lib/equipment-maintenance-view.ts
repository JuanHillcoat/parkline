import type { EquipmentListItem } from "../../src/fleet/application/equipment-visibility";
import type { EquipmentReadings } from "../../src/metering/application/use-cases/list-equipment-readings";
import { preventiveStatus, type PreventiveState } from "../../src/fleet/domain/preventive";
import { copy } from "./copy";
import type { MeterKindName } from "./readings-view";

const t = copy.fleet.detail.maintenance;

export type MaintenanceInput = {
  readonly meterKind: MeterKindName;
  /** The asset type interval in the meter's unit, or null when the type has none. */
  readonly interval: number | null;
  readonly baseReading: number | null;
  readonly lastReading: number | null;
  readonly hoursThisMonth: number;
};

export type Tone = "ok" | "warn" | "danger";
export type MaintenanceRow = { readonly label: string; readonly value: string; readonly tone: Tone | null };

/**
 * A figure of the card as the maintainer reads it: `230 hs`, `12,5 hs`, `1.234,5 km`. A whole number drops its
 * decimal; thousands use a dot.
 */
export const formatCycle = (value: number, unit: "hours" | "km"): string => {
  const [whole = "0", decimal = "0"] = Math.abs(value).toFixed(1).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ".");
  const sign = value < 0 && (whole !== "0" || decimal !== "0") ? "-" : "";
  return `${sign}${grouped}${decimal === "0" ? "" : `,${decimal}`} ${t.units[unit]}`;
};

export type MaintenanceView =
  | { readonly kind: "missing"; readonly reason: string }
  | {
      readonly kind: "figures";
      /** The hours (or km) accumulated in the current cycle, shown inside the ring. */
      readonly consumed: string;
      readonly percent: number;
      readonly state: PreventiveState;
      readonly stateLabel: string;
      readonly tone: Tone;
      readonly rows: readonly MaintenanceRow[];
    };

const TONES: Readonly<Record<PreventiveState, Tone>> = { ok: "ok", due_soon: "warn", overdue: "danger" };

type Figures = { readonly unit: "hours" | "km"; readonly interval: number; readonly base: number; readonly current: number };

const figuresView = (input: MaintenanceInput, { unit, interval, base, current }: Figures): MaintenanceView => {
  const status = preventiveStatus(interval, base, current);
  const tone = TONES[status.state];
  return {
    kind: "figures",
    consumed: formatCycle(status.consumed, unit),
    percent: Math.round(status.percent),
    state: status.state,
    stateLabel: t.states[status.state],
    tone,
    rows: [
      { label: t.current[unit], value: formatCycle(current, unit), tone: null },
      { label: t.month[unit], value: formatCycle(input.hoursThisMonth, unit), tone: null },
      { label: t.remaining[unit], value: formatCycle(status.remaining, unit), tone: tone === "ok" ? null : tone },
      { label: t.next, value: formatCycle(status.next, unit), tone: null },
    ],
  };
};

/**
 * Issue 60 D3: the card "Horas y mantenimiento". The cycle starts at the base reading and runs for the interval
 * of the asset type; without a meter, a reading or an interval the card says what is missing instead.
 */
export const buildMaintenanceView = (input: MaintenanceInput): MaintenanceView => {
  const { meterKind, interval, baseReading, lastReading } = input;
  if (meterKind === "none") return { kind: "missing", reason: t.noMeter };
  if (lastReading === null || baseReading === null) return { kind: "missing", reason: t.noReadings };
  if (interval === null) return { kind: "missing", reason: t.noInterval };
  return figuresView(input, { unit: meterKind, interval, base: baseReading, current: lastReading });
};

/**
 * The inputs of the card from the equipment and its readings (null when the actor cannot read them).
 * `monthHours` replaces the current month with the one the period filter picked.
 */
export const maintenanceInput = (item: EquipmentListItem, readings: EquipmentReadings | null, monthHours?: number): MaintenanceInput => ({
  meterKind: readings?.meterKind ?? item.assetType.meterKind,
  interval: item.assetType.preventiveIntervalHours,
  baseReading: readings?.baseReading ?? null,
  lastReading: readings?.lastReading?.value ?? null,
  hoursThisMonth: monthHours ?? readings?.hoursThisMonth ?? 0,
});
