import type { TransactionSql } from "postgres";
import type { OperationDirectory, OperationInfo } from "../../shared/domain/ports/operation-directory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OperationRow = {
  id: string;
  business_unit_id: string;
  site_id: string;
  archived_at: Date | null;
  site_archived_at: Date | null;
  division_archived_at: Date | null;
};

/** The archive instant of the operation, else of its site, else of its division. */
const archivedAtOf = (row: OperationRow): Date | null =>
  row.archived_at ?? row.site_archived_at ?? row.division_archived_at;

/**
 * Reads an operation for another module, inside that module's transaction. It takes a SHARED row
 * lock on the division, then the site, then the operation (the order of `lockParents` in the
 * organization guards: parents first), so an archive of any of them waits for the caller's
 * transaction instead of slipping between the check and the insert. A malformed id or a row of
 * another tenant answers null, like a missing one.
 */
export class PostgresOperationDirectory implements OperationDirectory {
  constructor(private readonly sql: TransactionSql) {}

  async find(tenantId: string, operationId: string): Promise<OperationInfo | null> {
    if (!UUID.test(tenantId) || !UUID.test(operationId)) return null;
    const ref = await this.sql<{ business_unit_id: string; site_id: string }[]>`
      select business_unit_id, site_id from operations where tenant_id = ${tenantId} and id = ${operationId}`;
    if (ref[0] === undefined) return null;
    await this.lockInOrder(tenantId, operationId, ref[0]);
    return this.read(tenantId, operationId);
  }

  private async lockInOrder(
    tenantId: string,
    operationId: string,
    parents: { business_unit_id: string; site_id: string },
  ): Promise<void> {
    await this.sql`select 1 from business_units where tenant_id = ${tenantId} and id = ${parents.business_unit_id} for share`;
    await this.sql`select 1 from sites where tenant_id = ${tenantId} and id = ${parents.site_id} for share`;
    await this.sql`select 1 from operations where tenant_id = ${tenantId} and id = ${operationId} for share`;
  }

  /** Read after the locks, so the archive state is the one that stays true until the caller commits. */
  private async read(tenantId: string, operationId: string): Promise<OperationInfo | null> {
    const rows = await this.sql<OperationRow[]>`
      select o.id, o.business_unit_id, o.site_id, o.archived_at,
             s.archived_at as site_archived_at, d.archived_at as division_archived_at
      from operations o
      join sites s on s.tenant_id = o.tenant_id and s.id = o.site_id
      join business_units d on d.tenant_id = o.tenant_id and d.id = o.business_unit_id
      where o.tenant_id = ${tenantId} and o.id = ${operationId}`;
    const row = rows[0];
    return row === undefined
      ? null
      : { id: row.id, businessUnitId: row.business_unit_id, siteId: row.site_id, archivedAt: archivedAtOf(row) };
  }
}
