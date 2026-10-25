import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { compareDays, parseDay, type Day } from "../../domain/day";
import type { Meter, MeterKind, MeterReading } from "../../domain/entities";
import { ReadingOutOfOrderError } from "../../domain/errors";
import { checkNewReading } from "../../domain/readings";
import { fromTenths, parseReadingValue } from "../../domain/values";
import { notInFuture, recordAudit } from "../audit";
import type { CoreDeps, MeteringDeps } from "../deps";
import { authorizeWrite, requireWritable, whenActive, type Access } from "../guards";
import type { MeteringTx } from "../ports/metering-tx";
import { parseOptionalReason } from "../reason";
import { buildReading, loadOpenSegment, type Segment } from "../timelines";

export type RecordReadingInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  /** The day the meter was read, `YYYY-MM-DD`; not in the future. */
  readonly day: string;
  /** What the meter showed: a number from 0 to 9999999.9 with at most one decimal. */
  readonly value: number;
  readonly reason?: string | null;
};

/**
 * Loads one immutable reading (D3). The first reading of an equipment opens its meter, of the kind its
 * asset type measures. A value below the previous reading, or above the following one for a backdated
 * reading, is refused: a lower value is a meter replacement. Needs `reading.write` at the position of the
 * open assignment of the equipment; the reason is optional.
 */
export class RecordReading {
  constructor(private readonly deps: MeteringDeps) {}

  execute(input: RecordReadingInput): Promise<Result<MeterReading, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.record(tx, input)));
  }

  private async record(tx: MeteringTx, input: RecordReadingInput): Promise<Result<MeterReading, DomainError>> {
    const access = await authorizeWrite(tx, this.deps, input.actor, input.equipmentId, "reading.write");
    if (!access.ok) return access;
    const fields = parseFields(this.deps, input);
    const kind = requireWritable(access.value.info);
    if (!fields.ok) return fields;
    if (!kind.ok) return kind;
    const open = await loadOpenSegment(tx, input.actor.tenantId, input.equipmentId);
    const fit = open === null ? ok(undefined) : fitsOpenMeter(open, fields.value);
    return fit.ok ? storeReading(this.deps, tx, { ...input, access: access.value, kind: kind.value, open, fields: fields.value }) : fit;
  }
}

export type Fields = { readonly day: Day; readonly tenths: number; readonly reason: string | null };

export type StorePlan = RecordReadingInput & {
  readonly access: Access;
  readonly kind: MeterKind;
  readonly open: Segment | null;
  readonly fields: Fields;
};

/**
 * A reading before the day a replacement installed the current meter belongs to a meter that is already
 * closed. The first meter has no such bound: it may still receive readings older than the one that opened it.
 */
export const fitsOpenMeter = (open: Segment, fields: Fields): Result<void, DomainError> =>
  open.timeline[0]?.kind === "replacement_open" && compareDays(fields.day, open.meter.openedOn) < 0
    ? err(new ReadingOutOfOrderError(`The day is before the current meter was installed on ${open.meter.openedOn}`))
    : checkNewReading(open.timeline, fields.day, fields.tenths);

/** Validates the day, the value and the optional reason of a reading; the day cannot be in the future. */
export const parseFields = (
  deps: Pick<MeteringDeps, "clock">,
  input: Pick<RecordReadingInput, "day" | "value" | "reason">,
): Result<Fields, DomainError> => {
  const day = parseDay(input.day);
  const value = parseReadingValue(input.value);
  const reason = parseOptionalReason(input.reason);
  if (!day.ok) return day;
  if (!value.ok) return value;
  if (!reason.ok) return reason;
  const future = notInFuture(deps, day.value);
  return future.ok ? ok({ day: day.value, tenths: value.value, reason: reason.value }) : future;
};

const openMeter = async (deps: CoreDeps, tx: MeteringTx, plan: StorePlan): Promise<Meter> => {
  const meter: Meter = {
    id: deps.ids.next(), tenantId: plan.actor.tenantId, equipmentId: plan.equipmentId, kind: plan.kind,
    openedOn: plan.fields.day, closedOn: null, initialValueTenths: plan.fields.tenths,
  };
  await tx.meters.add(meter);
  return meter;
};

/** Inserts the reading (opening the meter when there is none) and its audit entry, last, in the caller's transaction. */
export const storeReading = async (deps: CoreDeps, tx: MeteringTx, plan: StorePlan): Promise<Result<MeterReading, DomainError>> => {
  const { actor, equipmentId } = plan;
  const meter = plan.open?.meter ?? (await openMeter(deps, tx, plan));
  const reading = buildReading(deps, actor, {
    meterId: meter.id, kind: "reading", readOn: plan.fields.day, valueTenths: plan.fields.tenths, reason: plan.fields.reason,
  });
  await tx.readings.add(reading);
  await recordAudit(tx, deps, {
    action: "metering.reading.create", actor, access: plan.access, entityType: "meter_reading", entityId: reading.id,
    after: { equipmentId, meterId: meter.id, kind: reading.kind, day: reading.readOn, value: fromTenths(reading.valueTenths) },
    reason: reading.reason,
  });
  return ok(reading);
};
