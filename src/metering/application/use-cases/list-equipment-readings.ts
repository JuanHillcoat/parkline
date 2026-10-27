import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { dayOf, shiftDay, type Day } from "../../domain/day";
import type { Meter, MeterReading } from "../../domain/entities";
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
};

/**
 * The readings of one equipment for its detail page: the history newest first with the kind and the
 * `superseded` marker of each row, the open meter, its last effective reading and the hours (or km) of the
 * last 30 days. Needs `catalog.read` at the position of the open assignment: a missing equipment and one the
 * actor cannot see answer the same `not_found`. Read-only, no lock, no audit entry.
 */
export class ListEquipmentReadings {
  constructor(private readonly deps: MeteringDeps) {}

  execute(input: { readonly actor: Actor; readonly equipmentId: string }): Promise<Result<EquipmentReadings, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.list(tx, input)));
  }

  private async list(
    tx: MeteringTx,
    { actor, equipmentId }: { readonly actor: Actor; readonly equipmentId: string },
  ): Promise<Result<EquipmentReadings, DomainError>> {
    const access = await authorizeRead(tx, this.deps, actor, equipmentId);
    if (!access.ok) return access;
    const segments = await loadSegments(tx, actor.tenantId, equipmentId);
    const open = segments.find((segment) => segment.meter.closedOn === null) ?? null;
    const today = dayOf(this.deps.clock.now());
    return ok({
      meterKind: access.value.info.meterKind,
      archived: access.value.info.archived,
      meter: open?.meter ?? null,
      history: historyOf(segments),
      lastReading: lastOf(open),
      hoursLast30Days: hoursBetween(segments.map((s) => s.timeline), shiftDay(today, -RECENT_DAYS), today),
    });
  }
}

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
