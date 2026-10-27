import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { EffectiveReading, MeterReading } from "../../domain/entities";
import { ReadingNotFoundError } from "../../domain/errors";
import { checkCorrection, rootOf } from "../../domain/readings";
import { fromTenths, parseReadingValue } from "../../domain/values";
import { recordAudit } from "../audit";
import type { MeteringDeps } from "../deps";
import { authorizeWrite, requireWritable, whenActive, type Access } from "../guards";
import type { MeteringTx } from "../ports/metering-tx";
import { parseReason } from "../reason";
import { buildReading, loadSegments, type Segment } from "../timelines";

export type CorrectReadingInput = {
  readonly actor: Actor;
  readonly equipmentId: string;
  /** A reading of this equipment; correcting a correction corrects the original it descends from. */
  readonly readingId: string;
  readonly value: number;
  readonly reason: string;
};

type Target = { readonly segment: Segment; readonly original: EffectiveReading };
type Plan = { readonly access: Access; readonly target: Target; readonly tenths: number; readonly reason: string };

/**
 * Corrects a reading without editing it (D4): inserts a `correction` row that references the original, which
 * keeps its place in the order, so the new value must fit between its current neighbors. Needs
 * `reading.correct` at the position of the open assignment of the equipment and a mandatory reason; the
 * correction is a sensitive audit action.
 */
export class CorrectReading {
  constructor(private readonly deps: MeteringDeps) {}

  execute(input: CorrectReadingInput): Promise<Result<MeterReading, DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.correct(tx, input)));
  }

  private async correct(tx: MeteringTx, input: CorrectReadingInput): Promise<Result<MeterReading, DomainError>> {
    const access = await authorizeWrite(tx, this.deps, input.actor, input.equipmentId, "reading.correct");
    if (!access.ok) return access;
    const writable = requireWritable(access.value.info);
    if (!writable.ok) return writable;
    const reason = parseReason(input.reason);
    const value = parseReadingValue(input.value);
    if (!reason.ok) return reason;
    if (!value.ok) return value;
    const target = await this.find(tx, input);
    if (!target.ok) return target;
    const fit = checkCorrection(target.value.segment.timeline, target.value.original.id, value.value);
    return fit.ok ? this.store(tx, input.actor, { access: access.value, target: target.value, tenths: value.value, reason: reason.value }) : fit;
  }

  private async find(tx: MeteringTx, input: CorrectReadingInput): Promise<Result<Target, DomainError>> {
    const segments = await loadSegments(tx, input.actor.tenantId, input.equipmentId);
    for (const segment of segments) {
      const original = segment.timeline.find((reading) => reading.id === rootOf(segment.rows, input.readingId));
      if (original !== undefined && segment.rows.some((row) => row.id === input.readingId)) return ok({ segment, original });
    }
    return err(new ReadingNotFoundError(input.readingId));
  }

  private async store(tx: MeteringTx, actor: Actor, plan: Plan): Promise<Result<MeterReading, DomainError>> {
    const { original, segment } = plan.target;
    const correction = buildReading(this.deps, actor, {
      meterId: segment.meter.id, kind: "correction", readOn: original.readOn, valueTenths: plan.tenths,
      correctsId: original.id, reason: plan.reason,
    });
    await tx.readings.add(correction);
    await recordAudit(tx, this.deps, {
      action: "metering.reading.correct", actor, access: plan.access, entityType: "meter_reading", entityId: correction.id,
      before: { readingId: original.id, day: original.readOn, value: fromTenths(original.valueTenths) },
      after: { readingId: original.id, correctionId: correction.id, day: original.readOn, value: fromTenths(plan.tenths) },
      reason: plan.reason,
    });
    return ok(correction);
  }
}
