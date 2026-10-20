import type { TransactionSql } from "postgres";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { FleetTx } from "../application/ports/fleet-tx";
import {
  PostgresAssetTypeRepository,
  PostgresEquipmentRepository,
  PostgresSupplierRepository,
} from "./postgres-fleet-repositories";

/** Builds the fleet ports over one transaction handle. */
export const createPostgresFleetTx = (
  handle: TransactionSql,
  audit: AuditLog = new PostgresAuditLog(handle),
): FleetTx => ({
  suppliers: new PostgresSupplierRepository(handle),
  assetTypes: new PostgresAssetTypeRepository(handle),
  equipment: new PostgresEquipmentRepository(handle),
  audit,
});
