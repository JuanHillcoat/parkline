import type { AuditLog } from "../../../shared/domain/ports/audit-log";
import type { OperationDirectory } from "../../../shared/domain/ports/operation-directory";
import type { AssignmentRepository } from "./assignment-repository";
import type { AssetTypeRepository, EquipmentRepository, SupplierRepository } from "./repositories";

/** Everything a fleet use case touches inside one unit of work. */
export type FleetTx = {
  readonly suppliers: SupplierRepository;
  readonly assetTypes: AssetTypeRepository;
  readonly equipment: EquipmentRepository;
  readonly assignments: AssignmentRepository;
  /** Reads operations through the shared kernel; the organization module implements it. */
  readonly operations: OperationDirectory;
  readonly audit: AuditLog;
};
