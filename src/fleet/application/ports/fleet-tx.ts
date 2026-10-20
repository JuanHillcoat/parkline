import type { AuditLog } from "../../../shared/domain/ports/audit-log";
import type { AssetTypeRepository, EquipmentRepository, SupplierRepository } from "./repositories";

/** Everything a fleet use case touches inside one unit of work. */
export type FleetTx = {
  readonly suppliers: SupplierRepository;
  readonly assetTypes: AssetTypeRepository;
  readonly equipment: EquipmentRepository;
  readonly audit: AuditLog;
};
