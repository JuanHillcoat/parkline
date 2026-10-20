import type { AssetType, Equipment, Supplier } from "../../domain/entities";

// Every query takes the tenant id: a row of another tenant is never visible.
// `findByName` and `findByInternalCode` receive the normalized key and match ACTIVE rows only:
// an archived row owns no name and no internal code. `findById` and `listByTenant` return
// archived rows too; the use cases filter them.
// `add`, `rename`, `update` and `setArchivedAt` report a unique index rejection (a concurrent
// writer took the name or the internal code first) as a value, not an exception.

/**
 * What `setArchivedAt` reports for suppliers and asset types: stored, that a restore lost the
 * name to an active row, or that the row was no longer in the state the caller read (a concurrent
 * request archived or restored it first).
 */
export type SetArchivedAt = "done" | "name_taken" | "state_changed";

/** The same for equipment, which owns an internal code instead of a name. */
export type SetEquipmentArchivedAt = "done" | "internal_code_taken" | "state_changed";

/**
 * Row lock on a supplier or asset type, held until the transaction ends. A writer of equipment takes
 * "share" before it reads the parent's `archivedAt`; an archive takes "exclusive" before it counts
 * the active equipment. Either order then sees the other's committed write.
 */
export type ParentLock = "share" | "exclusive";

export interface SupplierRepository {
  lock(tenantId: string, id: string, mode: ParentLock): Promise<void>;
  findById(tenantId: string, id: string): Promise<Supplier | null>;
  findByName(tenantId: string, key: string): Promise<Supplier | null>;
  add(supplier: Supplier): Promise<boolean>;
  rename(tenantId: string, id: string, name: string): Promise<boolean>;
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt>;
  listByTenant(tenantId: string): Promise<readonly Supplier[]>;
}

export interface AssetTypeRepository {
  lock(tenantId: string, id: string, mode: ParentLock): Promise<void>;
  findById(tenantId: string, id: string): Promise<AssetType | null>;
  findByName(tenantId: string, key: string): Promise<AssetType | null>;
  add(assetType: AssetType): Promise<boolean>;
  /** Replaces name, meter kind and interval of an existing asset type (it must exist); false when the name is taken. */
  update(assetType: AssetType): Promise<boolean>;
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt>;
  listByTenant(tenantId: string): Promise<readonly AssetType[]>;
}

/** What `EquipmentRepository.add` reports: stored, or that the internal code index rejected the write. */
export type EquipmentAdd = "added" | "internal_code_taken";

/** What `EquipmentRepository.update` reports: stored, or that the internal code index rejected the write. */
export type EquipmentUpdate = "updated" | "internal_code_taken";

export interface EquipmentRepository {
  findById(tenantId: string, id: string): Promise<Equipment | null>;
  /** The ACTIVE equipment of the supplier whose internal code has this key. */
  findByInternalCode(tenantId: string, supplierId: string, key: string): Promise<Equipment | null>;
  /** How many ACTIVE equipment belong to the supplier / have the asset type. */
  countActiveBySupplier(tenantId: string, supplierId: string): Promise<number>;
  countActiveByAssetType(tenantId: string, assetTypeId: string): Promise<number>;
  add(equipment: Equipment): Promise<EquipmentAdd>;
  /** Replaces every editable field of an existing equipment (it must exist). */
  update(equipment: Equipment): Promise<EquipmentUpdate>;
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetEquipmentArchivedAt>;
  listByTenant(tenantId: string): Promise<readonly Equipment[]>;
}
