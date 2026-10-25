import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import { compareDays, parseDay, type Day } from "../../domain/day";
import type { Meter, MeterKind, MeterReading } from "../../domain/entities";
import { MeterReplacementInvalidError } from "../../domain/errors";
import { fromTenths, parseReadingValue } from "../../domain/values";
import { notInFuture, recordAudit } from "../audit";
import type { MeteringDeps } from "../deps";
import { authorizeWrite, requireWritable, whenActive, type Access } from "../guards";
import type { MeteringTx } from "../ports/metering-tx";
import { parseReason } from "../reason";
import { buildReading, loadOpenSegment, type Segment } from "../timelines";

export type ReplaceMeterInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  /** The day the old meter was taken out and the new one installed. */
  readonly day: string;
  /** What the old meter showed when it was taken out. */
  readonly finalValue: number;
  /** What the new meter shows when installed (any value from 0). */
  readonly initialValue: number;
  readonly reason: string;
};

export type ReplaceMeterOutput = {
  readonly closed: MeterReading;
  readonly opened: MeterReading;
  /** The new open meter. */
  readonly meter: Meter;
};

type Fields = { readonly day: Day; readonly finalTenths: number; readonly initialTenths: number; readonly reason: string };
type Plan = { readonly access: Access; readonly kind: MeterKind; readonly old: Segment; readonly fields: Fields };

/**
 * Replaces the meter of an equipment (D5): closes the open meter with a `replacement_close` reading of its
 * final value and opens a new one with a `replacement_open` reading, in one transaction. The final value
 * cannot be below the last effective reading nor the day before it. Needs `reading.correct` and a mandatory
 * reason; a sensitive audit action.
 */
export class ReplaceMeter {
  constructor(private readonly deps: MeteringDeps) {}

  execute(input: ReplaceMeterInput): Promise<Result<ReplaceMeterOutput, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.replace(tx, input)));
  }

  private async replace(tx: MeteringTx, input: ReplaceMeterInput): Promise<Result<ReplaceMeterOutput, DomainError>> {
    const access = await authorizeWrite(tx, this.deps, input.actor, input.equipmentId, "reading.correct");
    if (!access.ok) return access;
    const kind = requireWritable(access.value.info);
    const fields = this.parse(input);
    if (!fields.ok) return fields;
    if (!kind.ok) return kind;
    const old = await loadOpenSegment(tx, input.actor.tenantId, input.equipmentId);
    const closable = old === null ? invalid("The equipment has no open meter to replace") : canClose(old, fields.value);
    return closable.ok ? this.store(tx, input, { access: access.value, kind: kind.value, old: closable.value, fields: fields.value }) : closable;
  }

  private parse(input: ReplaceMeterInput): Result<Fields, DomainError> {
    const reason = parseReason(input.reason);
    const day = parseDay(input.day);
    const final = parseReadingValue(input.finalValue, "finalValue");
    const initial = parseReadingValue(input.initialValue, "initialValue");
    if (!reason.ok) return reason;
    if (!day.ok) return day;
    if (!final.ok) return final;
    if (!initial.ok) return initial;
    const future = notInFuture(this.deps, day.value);
    return future.ok ? ok({ day: day.value, finalTenths: final.value, initialTenths: initial.value, reason: reason.value }) : future;
  }

  private async store(tx: MeteringTx, input: ReplaceMeterInput, plan: Plan): Promise<Result<ReplaceMeterOutput, DomainError>> {
    const { actor } = input;
    const { fields, old } = plan;
    const fresh: Meter = {
      id: this.deps.ids.next(), tenantId: actor.tenantId, equipmentId: input.equipmentId, kind: plan.kind,
      openedOn: fields.day, closedOn: null, initialValueTenths: fields.initialTenths,
    };
    const row = (meterId: string, kind: "replacement_close" | "replacement_open", valueTenths: number) =>
      buildReading(this.deps, actor, { meterId, kind, readOn: fields.day, valueTenths, reason: fields.reason });
    const closed = row(old.meter.id, "replacement_close", fields.finalTenths);
    const opened = row(fresh.id, "replacement_open", fields.initialTenths);
    await tx.readings.add(closed);
    await tx.meters.close(actor.tenantId, old.meter.id, fields.day);
    await tx.meters.add(fresh);
    await tx.readings.add(opened);
    await this.audit(tx, actor, plan, fresh);
    return ok({ closed, opened, meter: fresh });
  }

  private audit(tx: MeteringTx, actor: Actor, plan: Plan, fresh: Meter): Promise<void> {
    const { fields, old } = plan;
    return recordAudit(tx, this.deps, {
      action: "metering.meter.replace", actor, access: plan.access, entityType: "meter", entityId: fresh.id,
      before: { meterId: old.meter.id, finalValue: fromTenths(fields.finalTenths), day: fields.day },
      after: { meterId: fresh.id, initialValue: fromTenths(fields.initialTenths), day: fields.day },
      reason: fields.reason,
    });
  }
}

const invalid = (message: string): Result<never, DomainError> => err(new MeterReplacementInvalidError(message));

/** The open meter can be closed on `day` with `finalTenths` when nothing follows `day` and the value does not go down. */
const canClose = (old: Segment, fields: Fields): Result<Segment, DomainError> => {
  const last = old.timeline.at(-1);
  if (last === undefined) return invalid("The meter has no readings to close");
  if (compareDays(fields.day, last.readOn) < 0) return invalid(`The replacement day is before the last reading (${last.readOn})`);
  if (fields.finalTenths < last.valueTenths) {
    return invalid(`The final value is lower than the last reading (${String(fromTenths(last.valueTenths))})`);
  }
  return ok(old);
};
