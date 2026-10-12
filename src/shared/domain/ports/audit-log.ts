export type AuditActorKind = "user" | "system" | "import";
export type AuditOrigin = "ui" | "import" | "job" | "api";

/** Mirrors the `audit_log` columns; `occurredAt` is supplied by the `Clock`. */
export type AuditEntry = {
  readonly occurredAt: Date;
  readonly actorId: string;
  readonly actorKind: AuditActorKind;
  readonly actorRole: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly subjectEquipmentId?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly tenantId: string;
  readonly businessUnitId?: string;
  readonly operationId?: string;
  readonly siteId?: string;
  readonly correlationId: string;
  readonly reason?: string;
  readonly origin: AuditOrigin;
};

/** Append-only. Must be called inside the unit of work of the change it describes. */
export interface AuditLog {
  record(entry: AuditEntry): Promise<void>;
}
