import type { TransactionSql } from "postgres";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { IdentityTx } from "../application/ports/identity-tx";
import { PostgresRoleAssignmentRepository } from "./postgres-role-assignment-repository";
import { PostgresSessionRepository } from "./postgres-session-repository";
import { PostgresTenantRepository } from "./postgres-tenant-repository";
import { PostgresUserRepository } from "./postgres-user-repository";

/** Builds the identity ports over one transaction handle. */
export const createPostgresIdentityTx = (
  handle: TransactionSql,
  audit: AuditLog = new PostgresAuditLog(handle),
): IdentityTx => ({
  tenants: new PostgresTenantRepository(handle),
  users: new PostgresUserRepository(handle),
  assignments: new PostgresRoleAssignmentRepository(handle),
  sessions: new PostgresSessionRepository(handle),
  audit,
});
