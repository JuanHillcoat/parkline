import type { TransactionSql } from "postgres";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { OperationDirectory } from "../../shared/domain/ports/operation-directory";
import type { AssignmentRepository } from "../application/ports/assignment-repository";
import type { FleetTx } from "../application/ports/fleet-tx";
import {
  PostgresAssetTypeRepository,
  PostgresEquipmentRepository,
  PostgresSupplierRepository,
} from "./postgres-fleet-repositories";

/**
 * TEMPORARY (T1 of P0-08): the assignment table and the organization read do not exist yet (T2/T3).
 * Reads see no assignments and no operations, which is the behavior before assignments; writes fail
 * loudly so nothing can pretend to be stored. T2 replaces both with the real adapters.
 */
const notWired = (): never => {
  throw new Error("Equipment assignments are not wired to Postgres yet (P0-08 T2)");
};

const UNWIRED_ASSIGNMENTS: AssignmentRepository = {
  findById: () => Promise.resolve(null),
  findOpen: () => Promise.resolve(null),
  listByEquipment: () => Promise.resolve([]),
  add: notWired,
  update: notWired,
};

const UNWIRED_OPERATIONS: OperationDirectory = { find: () => Promise.resolve(null) };

/** Builds the fleet ports over one transaction handle. */
export const createPostgresFleetTx = (
  handle: TransactionSql,
  audit: AuditLog = new PostgresAuditLog(handle),
): FleetTx => ({
  suppliers: new PostgresSupplierRepository(handle),
  assetTypes: new PostgresAssetTypeRepository(handle),
  equipment: new PostgresEquipmentRepository(handle),
  assignments: UNWIRED_ASSIGNMENTS,
  operations: UNWIRED_OPERATIONS,
  audit,
});
