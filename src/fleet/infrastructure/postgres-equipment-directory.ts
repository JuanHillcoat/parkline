import type { TransactionSql } from "postgres";
import type { ResourcePosition } from "../../shared/domain/ports/access-policy";
import type { EquipmentDirectory, EquipmentFindOptions, EquipmentInfo } from "../../shared/domain/ports/equipment-directory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = {
  id: string;
  meter_kind: "hours" | "km" | "none";
  archived: boolean;
  business_unit_id: string | null;
  operation_id: string | null;
  site_id: string | null;
};

/** The position of the open assignment: an operation's, or just the site's for a spare of the site (ADR-0013). */
const positionOf = (tenantId: string, row: Row): ResourcePosition | null => {
  if (row.site_id === null) return null;
  if (row.operation_id === null || row.business_unit_id === null) return { tenantId, siteId: row.site_id };
  return { tenantId, businessUnitId: row.business_unit_id, operationId: row.operation_id, siteId: row.site_id };
};

/**
 * Answers the metering module's question about an equipment (the shared `EquipmentDirectory` port),
 * inside that module's transaction. With `lock` it takes `FOR NO KEY UPDATE` on the equipment row, the
 * lock every writer of one equipment takes, held until the transaction ends. A malformed id, or a row of
 * another tenant, answers null, like a missing equipment (a malformed id without a query).
 */
export class PostgresEquipmentDirectory implements EquipmentDirectory {
  constructor(private readonly sql: TransactionSql) {}

  async find(tenantId: string, equipmentId: string, options: EquipmentFindOptions): Promise<EquipmentInfo | null> {
    if (!UUID.test(tenantId) || !UUID.test(equipmentId)) return null;
    const rows = options.lock ? await this.locked(tenantId, equipmentId) : await this.plain(tenantId, equipmentId);
    const row = rows[0];
    return row
      ? { id: row.id, meterKind: row.meter_kind, archived: row.archived, position: positionOf(tenantId, row) }
      : null;
  }

  private plain(tenantId: string, equipmentId: string): Promise<Row[]> {
    return this.sql<Row[]>`
      select e.id, t.meter_kind, e.archived_at is not null as archived,
             a.business_unit_id, a.operation_id, a.site_id
      from equipments e
      join asset_types t on t.tenant_id = e.tenant_id and t.id = e.asset_type_id
      left join equipment_assignments a
        on a.tenant_id = e.tenant_id and a.equipment_id = e.id and a.valid_to is null
      where e.tenant_id = ${tenantId} and e.id = ${equipmentId}`;
  }

  /** Locks the equipment row first, then reads the rest, so the answer is what the lock holder sees. */
  private async locked(tenantId: string, equipmentId: string): Promise<Row[]> {
    await this.sql`select 1 from equipments where tenant_id = ${tenantId} and id = ${equipmentId} for no key update`;
    return this.plain(tenantId, equipmentId);
  }
}
