import type { Actor } from "../../shared/domain/ports/access-policy";
import type { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { compareDays, dayOf, type Day } from "../domain/day";
import { ReadingInFutureError } from "../domain/errors";
import type { Access } from "./guards";
import type { CoreDeps, MeteringDeps } from "./deps";
import type { MeteringTx } from "./ports/metering-tx";

export type MeteringAudit = {
  readonly action: string;
  readonly actor: Actor;
  readonly access: Access;
  readonly entityType: "meter_reading" | "meter";
  readonly entityId: string;
  readonly before?: unknown;
  readonly after: unknown;
  readonly reason?: string | null;
};

const positionFields = ({ position }: Access) => ({
  businessUnitId: position.businessUnitId,
  operationId: position.operationId,
  siteId: position.siteId,
});

/** Writes the audit entry of a metering change; call it last, inside the unit of work. */
export const recordAudit = (tx: MeteringTx, deps: CoreDeps, entry: MeteringAudit): Promise<void> =>
  tx.audit.record({
    ...positionFields(entry.access),
    occurredAt: deps.clock.now(),
    actorId: entry.actor.userId,
    actorKind: "user",
    actorRole: entry.access.role,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    subjectEquipmentId: entry.access.info.id,
    before: entry.before,
    after: entry.after,
    tenantId: entry.actor.tenantId,
    correlationId: deps.ids.next(),
    reason: entry.reason ?? undefined,
    origin: "ui",
  });

/** A reading cannot be dated after today, by the injected clock. */
export const notInFuture = (deps: Pick<MeteringDeps, "clock">, day: Day): Result<void, DomainError> =>
  compareDays(day, dayOf(deps.clock.now())) > 0 ? err(new ReadingInFutureError()) : ok(undefined);
