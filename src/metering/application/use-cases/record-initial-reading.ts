import { ForbiddenError, type DomainError } from "../../../shared/domain/domain-error";
import type { InitialReading, InitialReadingInput, InitialReadingRecorder } from "../../../shared/domain/ports/initial-reading-recorder";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { CoreDeps } from "../deps";
import { requireWritable } from "../guards";
import type { MeteringTx } from "../ports/metering-tx";
import { fitsOpenMeter, parseFields, storeReading } from "./record-reading";
import { loadOpenSegment } from "../timelines";

type Deps = CoreDeps;

/**
 * The first reading of a new equipment, loaded inside the transaction of the caller (the registration), so
 * a failure here rolls the whole registration back. It does not open a unit of work of its own and does
 * not authorize: the caller did. Validation, the meter kind, the future day and the audit entry are the
 * same as `RecordReading`'s.
 */
export class RecordInitialReading implements InitialReadingRecorder<MeteringTx> {
  constructor(private readonly deps: Deps) {}

  async record(tx: MeteringTx, input: InitialReadingInput): Promise<Result<InitialReading, DomainError>> {
    if (input.tenantId !== input.actor.tenantId) return err(new ForbiddenError("Denied"));
    const kind = requireWritable({ id: input.equipmentId, meterKind: input.meterKind, archived: false, position: null });
    const fields = parseFields(this.deps, input);
    if (!kind.ok) return kind;
    if (!fields.ok) return fields;
    const open = await loadOpenSegment(tx, input.tenantId, input.equipmentId);
    const fit = open === null ? ok(undefined) : fitsOpenMeter(open, fields.value);
    if (!fit.ok) return fit;
    const position = input.position ?? { tenantId: input.tenantId };
    const info = { id: input.equipmentId, meterKind: input.meterKind, archived: false, position: input.position ?? null };
    const stored = await storeReading(this.deps, tx, {
      actor: input.actor, equipmentId: input.equipmentId, day: input.day, value: input.value,
      access: { info, role: input.actorRole, position }, kind: kind.value, open, fields: fields.value,
    });
    return stored.ok ? ok({ readingId: stored.value.id, meterId: stored.value.meterId }) : stored;
  }
}
