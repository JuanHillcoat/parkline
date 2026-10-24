import type { TransactionSql } from "postgres";
import type { AssignmentDirectory } from "../../shared/domain/ports/assignment-directory";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Answers the organization module's question about open assignments (the shared `AssignmentDirectory`
 * port), inside that module's transaction. It takes no lock itself: the caller holds the exclusive lock
 * on the operation row, which a concurrent assign (shared lock on the same row) serializes against. A
 * malformed id or a row of another tenant counts zero, like a missing one.
 */
export class PostgresAssignmentDirectory implements AssignmentDirectory {
  constructor(private readonly sql: TransactionSql) {}

  async countOpen(tenantId: string, operationId: string): Promise<number> {
    if (!UUID.test(tenantId) || !UUID.test(operationId)) return 0;
    const rows = await this.sql<{ open: number }[]>`
      select count(*)::int as open from equipment_assignments
      where tenant_id = ${tenantId} and operation_id = ${operationId} and valid_to is null`;
    return rows[0]?.open ?? 0;
  }
}
