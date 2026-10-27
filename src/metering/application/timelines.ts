import type { Actor } from "../../shared/domain/ports/access-policy";
import type { Day } from "../domain/day";
import type { EffectiveReading, Meter, MeterReading, ReadingKind } from "../domain/entities";
import { effectiveReadings } from "../domain/readings";
import type { CoreDeps } from "./deps";
import type { MeteringTx } from "./ports/metering-tx";

/** One meter with its stored rows (insertion order) and the effective timeline they produce. */
export type Segment = {
  readonly meter: Meter;
  readonly rows: readonly MeterReading[];
  readonly timeline: readonly EffectiveReading[];
};

const segmentOf = (meter: Meter, rows: readonly MeterReading[]): Segment => {
  const own = rows.filter((row) => row.meterId === meter.id);
  return { meter, rows: own, timeline: effectiveReadings(own) };
};

/** Every meter of the equipment, oldest first, each with its timeline. */
export const loadSegments = async (tx: MeteringTx, tenantId: string, equipmentId: string): Promise<readonly Segment[]> => {
  const meters = await tx.meters.listByEquipment(tenantId, equipmentId);
  const rows = await tx.readings.listByEquipment(tenantId, equipmentId);
  return meters.map((meter) => segmentOf(meter, rows));
};

/** The open meter of the equipment with its timeline, or null before its first reading. */
export const loadOpenSegment = async (tx: MeteringTx, tenantId: string, equipmentId: string): Promise<Segment | null> => {
  const meter = await tx.meters.findOpen(tenantId, equipmentId);
  return meter === null ? null : segmentOf(meter, await tx.readings.listByMeter(tenantId, meter.id));
};

export type NewReading = {
  readonly meterId: string;
  readonly kind: ReadingKind;
  readonly readOn: Day;
  readonly valueTenths: number;
  readonly correctsId?: string;
  readonly reason: string | null;
};

/** An immutable reading row created now by the actor. */
export const buildReading = (deps: CoreDeps, actor: Actor, fields: NewReading): MeterReading => ({
  id: deps.ids.next(),
  tenantId: actor.tenantId,
  meterId: fields.meterId,
  readOn: fields.readOn,
  valueTenths: fields.valueTenths,
  kind: fields.kind,
  correctsId: fields.correctsId ?? null,
  reason: fields.reason,
  createdBy: actor.userId,
  createdAt: deps.clock.now(),
});
