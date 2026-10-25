import type { AuditLog } from "../../../shared/domain/ports/audit-log";
import type { EquipmentDirectory } from "../../../shared/domain/ports/equipment-directory";
import type { MeterRepository, ReadingRepository } from "./repositories";

/** Everything a metering use case touches inside one unit of work. */
export type MeteringTx = {
  readonly meters: MeterRepository;
  readonly readings: ReadingRepository;
  /** Reads equipment through the shared kernel and takes its row lock; bound to this transaction. */
  readonly equipment: EquipmentDirectory;
  readonly audit: AuditLog;
};
