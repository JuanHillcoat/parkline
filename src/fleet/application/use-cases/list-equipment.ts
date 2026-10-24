import type { DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { ok, type Result } from "../../../shared/domain/result";
import { visibleEquipment, type EquipmentListItem, type VisibleEquipment } from "../equipment-visibility";
import type { FleetDeps } from "../deps";
import type { FleetTx } from "../ports/fleet-tx";
import { mayIncludeArchived, whenActive, withArchived } from "../guards";

export type ListEquipmentInput = {
  readonly actor: Actor;
  /** Honored only for an actor holding `catalog.archive`; otherwise ignored. */
  readonly includeArchived?: boolean;
};

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/**
 * Attaches the supplier and asset type names, read by id whatever the reader's scope (they are part of the
 * equipment's own data): one read per table, not one per row. The foreign keys guarantee the parents exist.
 */
async function withNames(tx: FleetTx, tenantId: string, rows: readonly VisibleEquipment[]): Promise<EquipmentListItem[]> {
  const [suppliers, types] = await Promise.all([
    tx.suppliers.findManyByIds(tenantId, unique(rows.map((row) => row.supplierId))),
    tx.assetTypes.findManyByIds(tenantId, unique(rows.map((row) => row.assetTypeId))),
  ]);
  const supplierOf = new Map(suppliers.map((supplier) => [supplier.id, { id: supplier.id, name: supplier.name }]));
  const typeOf = new Map(types.map((t) => [t.id, { id: t.id, name: t.name, meterKind: t.meterKind }]));
  return rows.map((row) => {
    const supplier = supplierOf.get(row.supplierId);
    const assetType = typeOf.get(row.assetTypeId);
    if (supplier === undefined || assetType === undefined) throw new Error(`Equipment ${row.id} has a missing parent`);
    return { ...row, supplier, assetType };
  });
}

/**
 * Read-only, no audit entry. Visibility follows the open assignment (D6 of P0-08): a tenant-wide
 * `catalog.read` sees every equipment, a scoped reader sees the equipment placed inside its scope and
 * nothing else. Each row carries its current assignment summary (or null) and the names of its supplier and
 * asset type, which a scoped reader could not read from the catalogs.
 */
export class ListEquipment {
  constructor(private readonly deps: FleetDeps) {}

  execute(input: ListEquipmentInput): Promise<Result<readonly EquipmentListItem[], DomainError>> {
    const { actor } = input;
    const policy = this.deps.accessPolicy;
    return whenActive(actor, () =>
      this.deps.unitOfWork.run(async (tx) => {
        const all = await tx.equipment.listByTenant(actor.tenantId);
        const rows = withArchived(all, mayIncludeArchived(policy, actor, input.includeArchived));
        const open = await tx.assignments.listOpen(actor.tenantId);
        return ok(await withNames(tx, actor.tenantId, visibleEquipment(policy, actor, rows, open)));
      }),
    );
  }
}
