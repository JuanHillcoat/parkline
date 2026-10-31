import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { dayOf, shiftDay, type Day } from "../../domain/day";
import type { Meter, MeterReading } from "../../domain/entities";
import { monthTotal, monthlyTotals } from "../../domain/monthly";
import { hoursBetween, rootOf, type HoursResult } from "../../domain/readings";
import { fromTenths } from "../../domain/values";
import type { MeteringDeps } from "../deps";
import { authorizeRead, whenActive } from "../guards";
import type { MeteringTx } from "../ports/metering-tx";
import { loadSegments, type Segment } from "../timelines";

/** The window of "hours of the last 30 days" shown next to the history. */
export const RECENT_DAYS = 30;

export type ReadingRow = MeterReading & {
  /** The value as people read it (`valueTenths / 10`). */
  readonly value: number;
  /** True for an original with a correction, and for a correction that a later one replaced. */
  readonly superseded: boolean;
};

export type LastReading = { readonly id: string; readonly meterId: string; readonly readOn: Day; readonly value: number };

export type EquipmentReadings = {
  readonly meterKind: "hours" | "km" | "none";
  readonly archived: boolean;
  readonly meter: Meter | null;
  /** Newest first: by day, then by creation. */
  readonly history: readonly ReadingRow[];
  /** The last effective reading of the open meter. */
  readonly lastReading: LastReading | null;
  readonly hoursLast30Days: HoursResult;
  /** The first effective reading of the open meter (issue 60 D3), or null without readings. */
  readonly baseReading: number | null;
  /** Hours (or km) of the current calendar month, in UTC days. */
  readonly hoursThisMonth: number;
  /** Hours (or km) of each month of the current year, January to December. */
  readonly monthlyTotals: readonly number[];
};

/** `year` picks the year of `monthlyTotals` (issue 60 D4); without it the current year. */
type ListInput = { readonly actor: Actor; readonly equipmentId: string; readonly year?: number };

/**
 * The readings of one equipment for its detail page: the history newest first with the kind and the
 * `superseded` marker of each row, the open meter, its last effective reading and the hours (or km) of the
 * last 30 days, the base reading of the open meter and the total of the current month and of each month of
 * the chosen year (the current one by default). Needs `catalog.read` at the position of the open assignment: a missing equipment and one the
 * actor cannot see answer the same `not_found`. Read-only, no lock, no audit entry.
 */
export class ListEquipmentReadings {
  constructor(private readonly deps: MeteringDeps) {}

  execute(input: ListInput): Promise<Result<EquipmentReadings, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.list(tx, input)));
  }

  private async list(tx: MeteringTx, { actor, equipmentId, year }: ListInput): Promise<Result<EquipmentReadings, DomainError>> {
    const access = await authorizeRead(tx, this.deps, actor, equipmentId);
    if (!access.ok) return access;
    const segments = await loadSegments(tx, actor.tenantId, equipmentId);
    const open = segments.find((segment) => segment.meter.closedOn === null) ?? null;
    return ok({
      meterKind: access.value.info.meterKind,
      archived: access.value.info.archived,
      meter: open?.meter ?? null,
      history: historyOf(segments),
      lastReading: lastOf(open),
      ...totalsOf(segments, dayOf(this.deps.clock.now()), year),
      baseReading: baseOf(open),
    });
  }
}

const totalsOf = (segments: readonly Segment[], today: Day, year: number | undefined) => {
  const timelines = segments.map((s) => s.timeline);
  return {
    hoursLast30Days: hoursBetween(timelines, shiftDay(today, -RECENT_DAYS), today),
    hoursThisMonth: monthTotal(timelines, today),
    monthlyTotals: monthlyTotals(timelines, year ?? Number(today.slice(0, 4))),
  };
};

const baseOf = (open: Segment | null): number | null => {
  const first = open?.timeline[0];
  return first === undefined ? null : fromTenths(first.valueTenths);
};

const lastOf = (open: Segment | null): LastReading | null => {
  const last = open?.timeline.at(-1);
  return open === null || last === undefined
    ? null
    : { id: last.id, meterId: open.meter.id, readOn: last.readOn, value: fromTenths(last.valueTenths) };
};

/** Every row, newest first by day then creation, with the `superseded` marker. */
const historyOf = (segments: readonly Segment[]): readonly ReadingRow[] => {
  const rows = segments.flatMap((segment) => segment.rows);
  const latestCorrection = new Map<string, string>();
  for (const row of rows) if (row.kind === "correction") latestCorrection.set(rootOf(rows, row.id), row.id);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.readOn === b.row.readOn ? b.index - a.index : a.row.readOn < b.row.readOn ? 1 : -1))
    .map(({ row }) => ({ ...row, value: fromTenths(row.valueTenths), superseded: isSuperseded(row, rows, latestCorrection) }));
};

const isSuperseded = (row: MeterReading, rows: readonly MeterReading[], latest: ReadonlyMap<string, string>): boolean => {
  const root = rootOf(rows, row.id);
  return latest.has(root) && latest.get(root) !== row.id;
};
