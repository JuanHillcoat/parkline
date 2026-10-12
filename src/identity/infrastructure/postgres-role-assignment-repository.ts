import type { TransactionSql } from "postgres";
import type { RoleAssignmentRepository } from "../application/ports/role-assignment-repository";
import type { RoleAssignment } from "../domain/role-assignment";
import { isUuid, toAssignment, type AssignmentRow } from "./postgres-rows";

export class PostgresRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly sql: TransactionSql) {}

  async listActiveByUser(tenantId: string, userId: string): Promise<readonly RoleAssignment[]> {
    if (!isUuid(tenantId) || !isUuid(userId)) return [];
    const rows = await this.sql<AssignmentRow[]>`
      select user_id, role, scope_type, scope_id
      from user_role_assignments
      where tenant_id = ${tenantId} and user_id = ${userId} and active
      order by created_at, id`;
    return rows.map(toAssignment);
  }

  async add(tenantId: string, assignment: RoleAssignment): Promise<void> {
    await this.sql`
      insert into user_role_assignments (id, tenant_id, user_id, role, scope_type, scope_id, active)
      values (gen_random_uuid(), ${tenantId}, ${assignment.userId}, ${assignment.role},
              ${assignment.scope.type}, ${assignment.scope.id}, ${assignment.active})`;
  }

  async deactivate(tenantId: string, assignment: RoleAssignment): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(assignment.userId)) return;
    await this.sql`
      update user_role_assignments set active = false
      where tenant_id = ${tenantId} and user_id = ${assignment.userId} and active
        and role = ${assignment.role} and scope_type = ${assignment.scope.type}
        and scope_id = ${assignment.scope.id}`;
  }

  async countActiveAdminUsers(tenantId: string): Promise<number> {
    if (!isUuid(tenantId)) return 0;
    const rows = await this.sql<{ n: number }[]>`
      select count(distinct a.user_id)::int as n
      from user_role_assignments a
      join users u on u.tenant_id = a.tenant_id and u.id = a.user_id
      where a.tenant_id = ${tenantId} and a.role = 'admin' and a.active and u.active`;
    return rows[0]?.n ?? 0;
  }
}
