import { nameKey } from "../../shared/domain/catalog-name";
import type { EquipmentImageRepository, StoredImage } from "../application/ports/equipment-image-repository";
import type { AssignmentRepository, AssignmentWrite } from "../application/ports/assignment-repository";
import type {
  AssetTypeRepository,
  EquipmentAdd,
  EquipmentRepository,
  EquipmentUpdate,
  SetArchivedAt,
  SetEquipmentArchivedAt,
  SupplierRepository,
} from "../application/ports/repositories";
import type { Assignment } from "../domain/assignment";
import type { AssetType, Equipment, Supplier } from "../domain/entities";
import { overlapsAny } from "../domain/periods";
import { compareByCode, compareByName } from "./row-order";

/** The data of one in-memory fleet database. A transaction works on a copy. */
export type FleetState = {
  suppliers: Supplier[];
  assetTypes: AssetType[];
  equipment: Equipment[];
  assignments: Assignment[];
  /** Keyed by equipment id (one image per equipment). */
  images: Map<string, StoredImage & { readonly tenantId: string }>;
};

export const emptyState = (): FleetState => ({ suppliers: [], assetTypes: [], equipment: [], assignments: [], images: new Map() });

type Row = { readonly id: string; readonly tenantId: string; readonly name: string; readonly archivedAt: Date | null };

const inTenant = <T extends { readonly tenantId: string }>(rows: readonly T[], tenantId: string): T[] =>
  rows.filter((row) => row.tenantId === tenantId);

const byId = <T extends { readonly id: string; readonly tenantId: string }>(rows: readonly T[], tenantId: string, id: string): T | null =>
  rows.find((row) => row.tenantId === tenantId && row.id === id) ?? null;

const active = <T extends { readonly tenantId: string; readonly archivedAt: Date | null }>(rows: readonly T[], tenantId: string): T[] =>
  inTenant(rows, tenantId).filter((row) => row.archivedAt === null);

/** The partial unique name index: the same tenant and the same name key, among ACTIVE rows. */
const nameCollides = (rows: readonly Row[], candidate: Row, ignoreId?: string): boolean =>
  rows.some(
    (row) =>
      row.archivedAt === null &&
      row.id !== ignoreId &&
      row.tenantId === candidate.tenantId &&
      nameKey(row.name) === nameKey(candidate.name),
  );

const insertNamed = <T extends Row>(rows: T[], row: T): boolean => {
  if (rows.some((existing) => existing.id === row.id)) throw new Error("unique violation on id");
  if (row.archivedAt === null && nameCollides(rows, row)) return false;
  rows.push(row);
  return true;
};

/** Replaces a row by id; an active row is checked against the active names like an insert. */
const replaceNamed = <T extends Row>(rows: T[], next: T): boolean => {
  const index = rows.findIndex((row) => row.tenantId === next.tenantId && row.id === next.id);
  if (index < 0) throw new Error(`update of a missing row ${next.id}`);
  if (next.archivedAt === null && nameCollides(rows, next, next.id)) return false;
  rows[index] = next;
  return true;
};

/** Archives or restores a row; a restore (null) is checked against the active names like an insert. */
const archiveNamed = (rows: Row[], tenantId: string, id: string, archivedAt: Date | null): SetArchivedAt => {
  const current = byId(rows, tenantId, id);
  if (current === null) throw new Error(`archive of a missing row ${id}`);
  const next = { ...current, archivedAt };
  if (archivedAt === null && nameCollides(rows, next, id)) return "name_taken";
  rows[rows.indexOf(current)] = next;
  return "done";
};

export class InMemorySupplierRepository implements SupplierRepository {
  constructor(private readonly state: FleetState) {}

  /** The in-memory unit of work is single-threaded: nothing to lock. */
  lock(): Promise<void> {
    return Promise.resolve();
  }

  findById(tenantId: string, id: string): Promise<Supplier | null> {
    return Promise.resolve(byId(this.state.suppliers, tenantId, id));
  }

  findManyByIds(tenantId: string, ids: readonly string[]): Promise<readonly Supplier[]> {
    return Promise.resolve(inTenant(this.state.suppliers, tenantId).filter((s) => ids.includes(s.id)));
  }

  findByName(tenantId: string, key: string): Promise<Supplier | null> {
    const found = active(this.state.suppliers, tenantId).find((s) => nameKey(s.name) === key);
    return Promise.resolve(found ?? null);
  }

  add(supplier: Supplier): Promise<boolean> {
    return Promise.resolve(insertNamed(this.state.suppliers, supplier));
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    const current = byId(this.state.suppliers, tenantId, id);
    if (current === null) throw new Error(`rename of a missing row ${id}`);
    return Promise.resolve(replaceNamed(this.state.suppliers, { ...current, name }));
  }

  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt> {
    return Promise.resolve(archiveNamed(this.state.suppliers, tenantId, id, archivedAt));
  }

  listByTenant(tenantId: string): Promise<readonly Supplier[]> {
    return Promise.resolve(inTenant(this.state.suppliers, tenantId).sort(compareByName));
  }
}

export class InMemoryAssetTypeRepository implements AssetTypeRepository {
  constructor(private readonly state: FleetState) {}

  lock(): Promise<void> {
    return Promise.resolve();
  }

  findById(tenantId: string, id: string): Promise<AssetType | null> {
    return Promise.resolve(byId(this.state.assetTypes, tenantId, id));
  }

  findManyByIds(tenantId: string, ids: readonly string[]): Promise<readonly AssetType[]> {
    return Promise.resolve(inTenant(this.state.assetTypes, tenantId).filter((t) => ids.includes(t.id)));
  }

  findByName(tenantId: string, key: string): Promise<AssetType | null> {
    const found = active(this.state.assetTypes, tenantId).find((t) => nameKey(t.name) === key);
    return Promise.resolve(found ?? null);
  }

  add(assetType: AssetType): Promise<boolean> {
    return Promise.resolve(insertNamed(this.state.assetTypes, assetType));
  }

  update(assetType: AssetType): Promise<boolean> {
    return Promise.resolve(replaceNamed(this.state.assetTypes, assetType));
  }

  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt> {
    return Promise.resolve(archiveNamed(this.state.assetTypes, tenantId, id, archivedAt));
  }

  listByTenant(tenantId: string): Promise<readonly AssetType[]> {
    return Promise.resolve(inTenant(this.state.assetTypes, tenantId).sort(compareByName));
  }
}

export class InMemoryEquipmentRepository implements EquipmentRepository {
  constructor(private readonly state: FleetState) {}

  /** The in-memory unit of work is single-threaded: nothing to lock. */
  lock(): Promise<void> {
    return Promise.resolve();
  }

  findById(tenantId: string, id: string): Promise<Equipment | null> {
    return Promise.resolve(byId(this.state.equipment, tenantId, id));
  }

  findByInternalCode(tenantId: string, supplierId: string, key: string): Promise<Equipment | null> {
    const found = active(this.state.equipment, tenantId).find(
      (e) => e.supplierId === supplierId && nameKey(e.internalCode) === key,
    );
    return Promise.resolve(found ?? null);
  }

  countActiveBySupplier(tenantId: string, supplierId: string): Promise<number> {
    return Promise.resolve(active(this.state.equipment, tenantId).filter((e) => e.supplierId === supplierId).length);
  }

  countActiveByAssetType(tenantId: string, assetTypeId: string): Promise<number> {
    return Promise.resolve(active(this.state.equipment, tenantId).filter((e) => e.assetTypeId === assetTypeId).length);
  }

  /** Mirrors the partial unique index: tenant, supplier and internal code key among active rows. */
  add(equipment: Equipment): Promise<EquipmentAdd> {
    const rows = this.state.equipment;
    if (rows.some((existing) => existing.id === equipment.id)) throw new Error("unique violation on id");
    if (equipment.archivedAt === null && this.codeCollides(equipment)) return Promise.resolve("internal_code_taken");
    rows.push(equipment);
    return Promise.resolve("added");
  }

  update(equipment: Equipment): Promise<EquipmentUpdate> {
    const rows = this.state.equipment;
    const index = rows.findIndex((e) => e.tenantId === equipment.tenantId && e.id === equipment.id);
    if (index < 0) throw new Error(`update of a missing row ${equipment.id}`);
    if (equipment.archivedAt === null && this.codeCollides(equipment, equipment.id)) {
      return Promise.resolve("internal_code_taken");
    }
    rows[index] = equipment;
    return Promise.resolve("updated");
  }

  /** A restore (null) is checked against the active internal codes of the supplier like an insert. */
  setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetEquipmentArchivedAt> {
    const current = byId(this.state.equipment, tenantId, id);
    if (current === null) throw new Error(`archive of a missing row ${id}`);
    const next = { ...current, archivedAt };
    if (archivedAt === null && this.codeCollides(next, id)) return Promise.resolve("internal_code_taken");
    this.state.equipment[this.state.equipment.indexOf(current)] = next;
    return Promise.resolve("done");
  }

  listByTenant(tenantId: string): Promise<readonly Equipment[]> {
    return Promise.resolve(inTenant(this.state.equipment, tenantId).sort(compareByCode));
  }

  private codeCollides(equipment: Equipment, ignoreId?: string): boolean {
    return this.state.equipment.some(
      (e) =>
        e.archivedAt === null &&
        e.id !== ignoreId &&
        e.tenantId === equipment.tenantId &&
        e.supplierId === equipment.supplierId &&
        nameKey(e.internalCode) === nameKey(equipment.internalCode),
    );
  }
}

/** Newest first: by start day descending, then id, so the order is total. */
const compareNewestFirst = (a: Assignment, b: Assignment): number =>
  a.validFrom < b.validFrom ? 1 : a.validFrom > b.validFrom ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

export class InMemoryAssignmentRepository implements AssignmentRepository {
  constructor(private readonly state: FleetState) {}

  findById(tenantId: string, id: string): Promise<Assignment | null> {
    return Promise.resolve(byId(this.state.assignments, tenantId, id));
  }

  findOpen(tenantId: string, equipmentId: string): Promise<Assignment | null> {
    const found = this.ofEquipment(tenantId, equipmentId).find((a) => a.validTo === null);
    return Promise.resolve(found ?? null);
  }

  listOpen(tenantId: string): Promise<readonly Assignment[]> {
    return Promise.resolve(inTenant(this.state.assignments, tenantId).filter((a) => a.validTo === null));
  }

  listByEquipment(tenantId: string, equipmentId: string): Promise<readonly Assignment[]> {
    return Promise.resolve(this.ofEquipment(tenantId, equipmentId).sort(compareNewestFirst));
  }

  /** Mirrors the exclusion constraint: no two periods of one equipment share a day. */
  add(assignment: Assignment): Promise<AssignmentWrite> {
    if (this.state.assignments.some((existing) => existing.id === assignment.id)) throw new Error("unique violation on id");
    if (this.collides(assignment)) return Promise.resolve("overlap");
    this.state.assignments.push(assignment);
    return Promise.resolve("stored");
  }

  update(assignment: Assignment): Promise<AssignmentWrite> {
    const rows = this.state.assignments;
    const index = rows.findIndex((a) => a.tenantId === assignment.tenantId && a.id === assignment.id);
    if (index < 0) throw new Error(`update of a missing row ${assignment.id}`);
    if (this.collides(assignment, assignment.id)) return Promise.resolve("overlap");
    rows[index] = assignment;
    return Promise.resolve("stored");
  }

  private ofEquipment(tenantId: string, equipmentId: string): Assignment[] {
    return inTenant(this.state.assignments, tenantId).filter((a) => a.equipmentId === equipmentId);
  }

  private collides(assignment: Assignment, ignoreId?: string): boolean {
    const others = this.ofEquipment(assignment.tenantId, assignment.equipmentId).filter((a) => a.id !== ignoreId);
    return overlapsAny(assignment, others);
  }
}

export class InMemoryEquipmentImageRepository implements EquipmentImageRepository {
  constructor(private readonly state: FleetState) {}

  find(tenantId: string, equipmentId: string): Promise<StoredImage | null> {
    const row = this.state.images.get(equipmentId);
    return Promise.resolve(row !== undefined && row.tenantId === tenantId ? row : null);
  }

  async findHash(tenantId: string, equipmentId: string): Promise<string | null> {
    return (await this.find(tenantId, equipmentId))?.sha256 ?? null;
  }

  findHashes(tenantId: string, equipmentIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const hashes = new Map<string, string>();
    for (const id of equipmentIds) {
      const row = this.state.images.get(id);
      if (row !== undefined && row.tenantId === tenantId) hashes.set(id, row.sha256);
    }
    return Promise.resolve(hashes);
  }

  /** Mirrors the composite foreign key: the equipment must exist in the tenant. */
  upsert(tenantId: string, equipmentId: string, image: StoredImage): Promise<void> {
    if (byId(this.state.equipment, tenantId, equipmentId) === null) throw new Error(`image of a missing equipment ${equipmentId}`);
    this.state.images.set(equipmentId, { ...image, tenantId });
    return Promise.resolve();
  }

  remove(tenantId: string, equipmentId: string): Promise<void> {
    if (this.state.images.get(equipmentId)?.tenantId === tenantId) this.state.images.delete(equipmentId);
    return Promise.resolve();
  }
}
