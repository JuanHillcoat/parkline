import type { AuditLog } from "../../../shared/domain/ports/audit-log";
import type { RoleAssignmentRepository } from "./role-assignment-repository";
import type { SessionRepository } from "./session-repository";
import type { TenantRepository } from "./tenant-repository";
import type { UserRepository } from "./user-repository";

/** Everything an identity use case touches inside one unit of work. */
export type IdentityTx = {
  readonly tenants: TenantRepository;
  readonly users: UserRepository;
  readonly assignments: RoleAssignmentRepository;
  readonly sessions: SessionRepository;
  readonly audit: AuditLog;
};
