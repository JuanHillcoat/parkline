import type { DomainError } from "../domain-error";
import type { Result } from "../result";
import type { Actor, ResourcePosition } from "./access-policy";

export type InitialReadingInput = {
  readonly actor: Actor;
  /** The tenant of the equipment; it must be the actor's. */
  readonly tenantId: string;
  readonly equipmentId: string;
  /** The meter kind of the equipment's asset type; `none` is refused with `no_meter`. */
  readonly meterKind: "hours" | "km" | "none";
  /** The day of the reading, `YYYY-MM-DD`, not in the future. */
  readonly day: string;
  /** What the meter showed: 0 to 9999999.9 with at most one decimal. */
  readonly value: number;
  /** The role that authorized the caller (for the audit entry's actor role). */
  readonly actorRole: string;
  /** Where the equipment sits, for the audit entry; defaults to the tenant. */
  readonly position?: ResourcePosition;
};

export type InitialReading = { readonly readingId: string; readonly meterId: string };

/**
 * Lets the module that registers equipment (fleet) load its first reading in the SAME transaction, without
 * importing the metering module (ADR-0005). `Tx` is the transaction handle of the implementation's own
 * module (`MeteringTx`); the container wires an adapter that derives it from the caller's transaction, so
 * the equipment, its first assignment and its first reading commit or roll back together. The caller has
 * already authorized the registration (`catalog.write`); the recorder does not authorize again. It opens
 * the meter, validates the value and the day, and writes the `metering.reading.create` audit entry last.
 */
export interface InitialReadingRecorder<Tx = unknown> {
  record(tx: Tx, input: InitialReadingInput): Promise<Result<InitialReading, DomainError>>;
}
