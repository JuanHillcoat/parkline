import type { TransactionSql } from "postgres";
import type { AssignmentRepository, AssignmentWrite } from "../application/ports/assignment-repository";
import type { Assignment, AssignmentKind } from "../domain/assignment";
import { assignmentWriteOf, exclusionViolationConstraint } from "./postgres-fleet-conflicts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: string): boolean => UUID.test(value);

type AssignmentRow = {
  id: string;
  tenant_id: string;
  equipment_id: string;
  business_unit_id: string;
  operation_id: string;
  site_id: string;
  kind: AssignmentKind;
  valid_from: string;
  valid_to: string | null;
  reason: string | null;
  created_by: string;
  created_at: Date;
};

const toAssignment = (row: AssignmentRow): Assignment => ({
  id: row.id,
  tenantId: row.tenant_id,
  equipmentId: row.equipment_id,
  businessUnitId: row.business_unit_id,
  operationId: row.operation_id,
  siteId: row.site_id,
  kind: row.kind,
  validFrom: row.valid_from,
  validTo: row.valid_to,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: row.created_at,
});

// Days leave the database as text: the driver would turn a `date` into a JS Date.
const COLUMNS = (sql: TransactionSql) => sql`
  id, tenant_id, equipment_id, business_unit_id, operation_id, site_id, kind,
  to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to,
  reason, created_by, created_at`;

type Write = (scope: TransactionSql) => PromiseLike<{ count: number }>;

/**
 * Runs a write in a savepoint, so an exclusion violation of the no-overlap constraint (a concurrent
 * writer took the days) rolls back only the statement and becomes "overlap". Any other error,
 * even another 23P01, is rethrown.
 */
const attempt = async (sql: TransactionSql, write: Write): Promise<AssignmentWrite> => {
  try {
    await sql.savepoint(async (scope) => await write(scope));
    return "stored";
  } catch (error) {
    const conflict = assignmentWriteOf(exclusionViolationConstraint(error));
    if (conflict === null) throw error;
    return conflict;
  }
};

export class PostgresAssignmentRepository implements AssignmentRepository {
  constructor(private readonly sql: TransactionSql) {}

  /**
   * Serializes the writers of one equipment. Two transactions that insert overlapping rows at once would
   * each wait for the other inside the exclusion check and Postgres would kill one with a deadlock (40P01);
   * with this lock the second one waits here, then meets the committed row and gets the 23P01 as a value.
   * NO KEY UPDATE does not block the key-share locks the foreign keys of other tables take.
   */
  private async lockEquipment(a: Assignment): Promise<void> {
    await this.sql`select 1 from equipments where tenant_id = ${a.tenantId} and id = ${a.equipmentId} for no key update`;
  }

  async findById(tenantId: string, id: string): Promise<Assignment | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<AssignmentRow[]>`
      select ${COLUMNS(this.sql)} from equipment_assignments where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async findOpen(tenantId: string, equipmentId: string): Promise<Assignment | null> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return null;
    const rows = await this.sql<AssignmentRow[]>`
      select ${COLUMNS(this.sql)} from equipment_assignments
      where tenant_id = ${tenantId} and equipment_id = ${equipmentId} and valid_to is null`;
    return rows[0] ? toAssignment(rows[0]) : null;
  }

  async listOpen(tenantId: string): Promise<readonly Assignment[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<AssignmentRow[]>`
      select ${COLUMNS(this.sql)} from equipment_assignments where tenant_id = ${tenantId} and valid_to is null`;
    return rows.map(toAssignment);
  }

  async listByEquipment(tenantId: string, equipmentId: string): Promise<readonly Assignment[]> {
    if (!isUuid(tenantId) || !isUuid(equipmentId)) return [];
    const rows = await this.sql<AssignmentRow[]>`
      select ${COLUMNS(this.sql)} from equipment_assignments
      where tenant_id = ${tenantId} and equipment_id = ${equipmentId}
      order by valid_from desc, id`;
    return rows.map(toAssignment);
  }

  async add(a: Assignment): Promise<AssignmentWrite> {
    await this.lockEquipment(a);
    return await attempt(
      this.sql,
      (s) => s`
        insert into equipment_assignments
          (id, tenant_id, equipment_id, business_unit_id, operation_id, site_id, kind,
           valid_from, valid_to, reason, created_by, created_at)
        values (${a.id}, ${a.tenantId}, ${a.equipmentId}, ${a.businessUnitId}, ${a.operationId}, ${a.siteId},
                ${a.kind}, ${a.validFrom}::date, ${a.validTo}::date, ${a.reason}, ${a.createdBy}, ${a.createdAt})`,
    );
  }

  async update(a: Assignment): Promise<AssignmentWrite> {
    await this.lockEquipment(a);
    let count = 0;
    const result = await attempt(this.sql, async (s) => {
      const done = await s`
        update equipment_assignments
        set business_unit_id = ${a.businessUnitId}, operation_id = ${a.operationId}, site_id = ${a.siteId},
            kind = ${a.kind}, valid_from = ${a.validFrom}::date, valid_to = ${a.validTo}::date, reason = ${a.reason}
        where tenant_id = ${a.tenantId} and id = ${a.id}`;
      count = done.count;
      return done;
    });
    if (result === "stored" && count !== 1) throw new Error(`update of a missing assignment ${a.id}`);
    return result;
  }
}
