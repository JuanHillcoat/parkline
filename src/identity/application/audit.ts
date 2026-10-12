import type { AuditEntry, AuditOrigin } from "../../shared/domain/ports/audit-log";
import type { IdentityDeps } from "./deps";
import type { IdentityTx } from "./ports/identity-tx";

export type AuditFields = Omit<AuditEntry, "occurredAt" | "correlationId" | "origin"> & {
  readonly origin?: AuditOrigin;
};

/** Writes inside the caller's unit of work. Time and correlation id come from the ports. */
export const recordAudit = (
  tx: IdentityTx,
  deps: Pick<IdentityDeps, "clock" | "ids">,
  fields: AuditFields,
): Promise<void> =>
  tx.audit.record({
    ...fields,
    origin: fields.origin ?? "ui",
    occurredAt: deps.clock.now(),
    correlationId: deps.ids.next(),
  });
