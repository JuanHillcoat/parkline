import type { JSONValue, TransactionSql } from "postgres";
import type { AuditEntry, AuditLog } from "../domain/ports/audit-log";

/**
 * Appends to `audit_log` through the handle of the unit of work, so the entry
 * commits or rolls back together with the change it describes.
 */
export class PostgresAuditLog implements AuditLog {
  constructor(private readonly sql: TransactionSql) {}

  async record(entry: AuditEntry): Promise<void> {
    const { sql } = this;
    const json = (value: unknown) => (value === undefined ? null : sql.json(value as JSONValue));
    await sql`
      insert into audit_log
        (tenant_id, occurred_at, actor_id, actor_kind, role, action, entity_type, entity_id,
         subject_equipment_id, business_unit_id, operation_id, site_id,
         before, after, reason, correlation_id, origin)
      values
        (${entry.tenantId}, ${entry.occurredAt}, ${entry.actorId}, ${entry.actorKind},
         ${entry.actorRole}, ${entry.action}, ${entry.entityType}, ${entry.entityId},
         ${entry.subjectEquipmentId ?? null}, ${entry.businessUnitId ?? null},
         ${entry.operationId ?? null}, ${entry.siteId ?? null},
         ${json(entry.before)}, ${json(entry.after)}, ${entry.reason ?? null},
         ${entry.correlationId}, ${entry.origin})
    `;
  }
}
