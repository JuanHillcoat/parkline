import type { TransactionSql } from "postgres";
import type { AssignmentDirectory } from "../../shared/domain/ports/assignment-directory";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { OrganizationTx } from "../application/ports/organization-tx";
import {
  PostgresBusinessUnitRepository,
  PostgresOperationRepository,
  PostgresSiteRepository,
} from "./postgres-organization-repositories";

/**
 * Builds the assignment directory over the transaction handle. The fleet module implements the shared
 * port; the composition root hands the factory in, so organization never imports fleet code.
 */
export type AssignmentDirectoryFactory = (handle: TransactionSql) => AssignmentDirectory;

/** Builds the organization ports over one transaction handle. */
export const createPostgresOrganizationTx = (
  handle: TransactionSql,
  assignments: AssignmentDirectoryFactory,
  audit: AuditLog = new PostgresAuditLog(handle),
): OrganizationTx => ({
  businessUnits: new PostgresBusinessUnitRepository(handle),
  operations: new PostgresOperationRepository(handle),
  sites: new PostgresSiteRepository(handle),
  assignments: assignments(handle),
  audit,
});
