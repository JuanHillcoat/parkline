import type { FleetTx } from "./ports/fleet-tx";
import type { EquipmentListItem, VisibleEquipment } from "./equipment-visibility";

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/**
 * Attaches the supplier and asset type names and the image hash (never the image bytes), read by id whatever the reader's scope (they are part of the
 * equipment's own data): one read per table, not one per row. The foreign keys guarantee the parents exist.
 */
export async function withNames(tx: FleetTx, tenantId: string, rows: readonly VisibleEquipment[]): Promise<EquipmentListItem[]> {
  const [suppliers, types, hashes] = await Promise.all([
    tx.suppliers.findManyByIds(tenantId, unique(rows.map((row) => row.supplierId))),
    tx.assetTypes.findManyByIds(tenantId, unique(rows.map((row) => row.assetTypeId))),
    tx.images.findHashes(tenantId, rows.map((row) => row.id)),
  ]);
  const supplierOf = new Map(suppliers.map((supplier) => [supplier.id, { id: supplier.id, name: supplier.name }]));
  const typeOf = new Map(types.map((t) => [t.id, { id: t.id, name: t.name, meterKind: t.meterKind, preventiveIntervalHours: t.preventiveIntervalHours }]));
  return rows.map((row) => {
    const supplier = supplierOf.get(row.supplierId);
    const assetType = typeOf.get(row.assetTypeId);
    if (supplier === undefined || assetType === undefined) throw new Error(`Equipment ${row.id} has a missing parent`);
    return { ...row, supplier, assetType, imageHash: hashes.get(row.id) ?? null };
  });
}
