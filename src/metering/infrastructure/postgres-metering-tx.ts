import type { TransactionSql } from "postgres";
import type { AuditLog } from "../../shared/domain/ports/audit-log";
import type { EquipmentDirectory } from "../../shared/domain/ports/equipment-directory";
import { PostgresAuditLog } from "../../shared/infrastructure/postgres-audit-log";
import type { MeteringTx } from "../application/ports/metering-tx";
import { PostgresMeterRepository, PostgresReadingRepository } from "./postgres-metering-repositories";

/**
 * Builds the equipment directory over the transaction handle. The fleet module implements the shared
 * port; the composition root hands the factory in, so metering never imports fleet code.
 */
export type EquipmentDirectoryFactory = (handle: TransactionSql) => EquipmentDirectory;

/** Builds the metering ports over one transaction handle (a new one, or the handle of a caller's transaction). */
export const createPostgresMeteringTx = (
  handle: TransactionSql,
  equipment: EquipmentDirectoryFactory,
  audit: AuditLog = new PostgresAuditLog(handle),
): MeteringTx => ({
  meters: new PostgresMeterRepository(handle),
  readings: new PostgresReadingRepository(handle),
  equipment: equipment(handle),
  audit,
});
