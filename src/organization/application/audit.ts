import type { AuditEntry, AuditOrigin } from "../../shared/domain/ports/audit-log";
import type { OrganizationDeps } from "./deps";
import type { OrganizationTx } from "./ports/organization-tx";

export type AuditFields = Omit<AuditEntry, "occurredAt" | "correlationId" | "origin"> & {
  readonly origin?: AuditOrigin;
};

/** Writes inside the caller's unit of work. Time and correlation id come from the ports. */
export const recordAudit = (
  tx: OrganizationTx,
  deps: Pick<OrganizationDeps, "clock" | "ids">,
  fields: AuditFields,
): Promise<void> =>
  tx.audit.record({
    ...fields,
    origin: fields.origin ?? "ui",
    occurredAt: deps.clock.now(),
    correlationId: deps.ids.next(),
  });
