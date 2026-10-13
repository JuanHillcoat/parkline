import type { RoleAssignment } from "../../domain/role-assignment";

export interface RoleAssignmentRepository {
  listActiveByUser(tenantId: string, userId: string): Promise<readonly RoleAssignment[]>;
  add(tenantId: string, assignment: RoleAssignment): Promise<void>;
  /** Deactivates the active assignment with the same user, role and scope. */
  deactivate(tenantId: string, assignment: RoleAssignment): Promise<void>;
  /** Active users of the tenant that hold an active admin assignment. */
  countActiveAdminUsers(tenantId: string): Promise<number>;
}
