import { ConflictError, ValidationError, type DomainError } from "../../../shared/domain/domain-error";
import type { Clock } from "../../../shared/domain/ports/clock";
import type { InitialReading, InitialReadingInput, InitialReadingRecorder } from "../../../shared/domain/ports/initial-reading-recorder";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { FleetTx } from "../../application/ports/fleet-tx";

class FakeNoMeter extends ConflictError {
  readonly code: string = "no_meter";
}

class FakeInvalidValue extends ValidationError {
  readonly code: string = "invalid_reading_value";
}

class FakeInFuture extends ValidationError {
  readonly code: string = "reading_in_future";
}

const validValue = (value: number): boolean => {
  const scaled = value * 10;
  return Number.isFinite(value) && value >= 0 && Math.abs(scaled - Math.round(scaled)) < 1e-6;
};

/**
 * Test double of the shared `InitialReadingRecorder`: fleet must not import metering, so it tests against
 * this fake. It validates like the real recorder (kind, value, future day) and, like it, writes the
 * `metering.reading.create` audit entry through the caller's transaction.
 */
export class FakeInitialReadingRecorder implements InitialReadingRecorder<FleetTx> {
  readonly calls: InitialReadingInput[] = [];

  constructor(private readonly clock: Clock) {}

  async record(tx: FleetTx, input: InitialReadingInput): Promise<Result<InitialReading, DomainError>> {
    this.calls.push(input);
    if (input.meterKind === "none") return err(new FakeNoMeter("This equipment has no meter"));
    if (!validValue(input.value)) return err(new FakeInvalidValue("The value is a number from 0 to 9999999.9 with at most one decimal"));
    if (input.day > this.clock.now().toISOString().slice(0, 10)) return err(new FakeInFuture("A reading cannot be dated in the future"));
    const id = String(this.calls.length);
    await tx.audit.record({
      occurredAt: this.clock.now(),
      actorId: input.actor.userId,
      actorKind: "user",
      actorRole: input.actorRole,
      action: "metering.reading.create",
      entityType: "meter_reading",
      entityId: `reading-${id}`,
      subjectEquipmentId: input.equipmentId,
      after: { day: input.day, value: input.value },
      tenantId: input.tenantId,
      correlationId: "fake",
      origin: "ui",
    });
    return ok({ readingId: `reading-${id}`, meterId: `meter-${id}` });
  }
}
