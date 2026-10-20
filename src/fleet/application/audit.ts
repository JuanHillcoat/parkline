import type { AuditEntry, AuditOrigin } from "../../shared/domain/ports/audit-log";
import type { AssetType, Equipment, Supplier } from "../domain/entities";
import type { FleetDeps } from "./deps";
import type { FleetTx } from "./ports/fleet-tx";

export type AuditFields = Omit<AuditEntry, "occurredAt" | "correlationId" | "origin"> & {
  readonly origin?: AuditOrigin;
};

export const assetTypeSnapshot = (assetType: AssetType) => ({
  name: assetType.name,
  meterKind: assetType.meterKind,
  preventiveIntervalHours: assetType.preventiveIntervalHours,
});

/** The fields an equipment audit entry records: ids plus the supplier and type names, for readability. */
export const equipmentSnapshot = (equipment: Equipment, supplier: Supplier, assetType: AssetType) => ({
  supplierId: equipment.supplierId,
  supplierName: supplier.name,
  assetTypeId: equipment.assetTypeId,
  assetTypeName: assetType.name,
  internalCode: equipment.internalCode,
  brand: equipment.brand,
  model: equipment.model,
  year: equipment.year,
  serialNumber: equipment.serialNumber,
  batteryQuantity: equipment.batteryQuantity,
  observations: equipment.observations,
});

/** Writes inside the caller's unit of work. Time and correlation id come from the ports. */
export const recordAudit = (
  tx: FleetTx,
  deps: Pick<FleetDeps, "clock" | "ids">,
  fields: AuditFields,
): Promise<void> =>
  tx.audit.record({
    ...fields,
    origin: fields.origin ?? "ui",
    occurredAt: deps.clock.now(),
    correlationId: deps.ids.next(),
  });
