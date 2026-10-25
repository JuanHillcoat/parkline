import type { TransactionSql } from "postgres";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import type { OperationDirectory } from "../../shared/domain/ports/operation-directory";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { FleetTx } from "../application/ports/fleet-tx";
import { PostgresAssignmentRepository } from "./postgres-assignment-repository";
import { PostgresEquipmentImageRepository } from "./postgres-equipment-image-repository";
import {
  PostgresAssetTypeRepository,
  PostgresEquipmentRepository,
  PostgresSupplierRepository,
} from "./postgres-fleet-repositories";

/**
 * Builds the operation directory over the transaction handle. The organization module implements the
 * shared port; the composition root hands the factory in, so fleet never imports organization code.
 */
export type OperationDirectoryFactory = (handle: TransactionSql) => OperationDirectory;

const handles = new WeakMap<FleetTx, TransactionSql>();

/**
 * The SQL transaction a `FleetTx` was built over, so the composition root can make another module's
 * adapter join the same transaction (for example the first reading of a new equipment). Undefined for a
 * `FleetTx` that did not come from `createPostgresFleetTx` (the in-memory fakes).
 */
export const sqlOfFleetTx = (tx: FleetTx): TransactionSql | undefined => handles.get(tx);

/** Builds the fleet ports over one transaction handle. */
export const createPostgresFleetTx = (
  handle: TransactionSql,
  operations: OperationDirectoryFactory,
  audit: AuditLog = new PostgresAuditLog(handle),
): FleetTx => {
  const tx: FleetTx = {
    suppliers: new PostgresSupplierRepository(handle),
    assetTypes: new PostgresAssetTypeRepository(handle),
    equipment: new PostgresEquipmentRepository(handle),
    assignments: new PostgresAssignmentRepository(handle),
    images: new PostgresEquipmentImageRepository(handle),
    operations: operations(handle),
    audit,
  };
  handles.set(tx, handle);
  return tx;
};
