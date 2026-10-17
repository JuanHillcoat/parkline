import type { TransactionSql } from "postgres";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { OrganizationTx } from "../application/ports/organization-tx";
import {
  PostgresBusinessUnitRepository,
  PostgresOperationRepository,
  PostgresOperationSiteRepository,
  PostgresSiteRepository,
} from "./postgres-organization-repositories";

/** Builds the organization ports over one transaction handle. */
export const createPostgresOrganizationTx = (
  handle: TransactionSql,
  audit: AuditLog = new PostgresAuditLog(handle),
): OrganizationTx => ({
  businessUnits: new PostgresBusinessUnitRepository(handle),
  operations: new PostgresOperationRepository(handle),
  sites: new PostgresSiteRepository(handle),
  links: new PostgresOperationSiteRepository(handle),
  audit,
});
