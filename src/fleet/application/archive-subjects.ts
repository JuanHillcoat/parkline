import { err, ok, type Result } from "../../shared/domain/result";
import type { DomainError } from "../../shared/domain/domain-error";
import type { AssetType, Equipment, Supplier } from "../domain/entities";
import { AlreadyArchivedError, HasActiveEquipmentError, HasOpenAssignmentError, NotArchivedError } from "../domain/errors";
import { nameKey } from "../../shared/domain/catalog-name";
import type { ArchiveSubject } from "./archiving";
import { internalCodeTaken, loadActiveParents, nameTaken, requireFreeName } from "./guards";
import type { SetArchivedAt, SetEquipmentArchivedAt } from "./ports/repositories";

/** The write found the row already in the requested state: a concurrent archive or restore won. */
const stateChanged = (label: string, id: string, archivedAt: Date | null): Result<void, DomainError> =>
  archivedAt === null
    ? err(new NotArchivedError(`${label} ${id} is not archived`))
    : err(new AlreadyArchivedError(`${label} ${id} is already archived`));

/** Maps what a repository reported to the typed result; a restore can lose its name to a concurrent writer. */
const outcome = (
  stored: SetArchivedAt,
  row: { readonly id: string; readonly name: string },
  label: string,
  archivedAt: Date | null,
): Result<void, DomainError> => {
  switch (stored) {
    case "done":
      return ok(undefined);
    case "state_changed":
      return stateChanged(label, row.id, archivedAt);
    case "name_taken":
      return nameTaken(row.name);
  }
};

const equipmentOutcome = (stored: SetEquipmentArchivedAt, row: Equipment, archivedAt: Date | null): Result<void, DomainError> => {
  switch (stored) {
    case "done":
      return ok(undefined);
    case "state_changed":
      return stateChanged("Equipment", row.id, archivedAt);
    case "internal_code_taken":
      return internalCodeTaken(row.internalCode);
  }
};

/** Archiving a supplier or an asset type first needs its equipment archived (no cascade). */
const requireNoActiveEquipment = (count: number, label: string): Result<void, DomainError> =>
  count === 0 ? ok(undefined) : err(new HasActiveEquipmentError(`${label} still has ${String(count)} active equipment`));

/** An equipment with an open assignment cannot be archived: its assignment is ended first. */
const requireNoOpenAssignment = (open: { readonly id: string } | null, equipmentId: string): Result<void, DomainError> =>
  open === null ? ok(undefined) : err(new HasOpenAssignmentError(`Equipment ${equipmentId} still has an open assignment`));

export const supplierSubject: ArchiveSubject<Supplier> = {
  entityType: "supplier",
  label: "Supplier",
  find: (tx, tenantId, id) => tx.suppliers.findById(tenantId, id),
  check: async (tx, verb, row) => {
    if (verb === "archive") {
      await tx.suppliers.lock(row.tenantId, row.id, "exclusive");
      return requireNoActiveEquipment(await tx.equipment.countActiveBySupplier(row.tenantId, row.id), supplierSubject.label);
    }
    return requireFreeName(await tx.suppliers.findByName(row.tenantId, nameKey(row.name)), row.name, row.id);
  },
  store: async (tx, row, archivedAt) =>
    outcome(await tx.suppliers.setArchivedAt(row.tenantId, row.id, archivedAt), row, "Supplier", archivedAt),
};

export const assetTypeSubject: ArchiveSubject<AssetType> = {
  entityType: "asset_type",
  label: "Asset type",
  find: (tx, tenantId, id) => tx.assetTypes.findById(tenantId, id),
  check: async (tx, verb, row) => {
    if (verb === "archive") {
      await tx.assetTypes.lock(row.tenantId, row.id, "exclusive");
      return requireNoActiveEquipment(await tx.equipment.countActiveByAssetType(row.tenantId, row.id), assetTypeSubject.label);
    }
    return requireFreeName(await tx.assetTypes.findByName(row.tenantId, nameKey(row.name)), row.name, row.id);
  },
  store: async (tx, row, archivedAt) =>
    outcome(await tx.assetTypes.setArchivedAt(row.tenantId, row.id, archivedAt), row, "Asset type", archivedAt),
};

export const equipmentSubject: ArchiveSubject<Equipment> = {
  entityType: "equipment",
  label: "Equipment",
  find: (tx, tenantId, id) => tx.equipment.findById(tenantId, id),
  check: async (tx, verb, row) => {
    if (verb === "archive") return requireNoOpenAssignment(await tx.assignments.findOpen(row.tenantId, row.id), row.id);
    const parents = await loadActiveParents(tx, row.tenantId, row.supplierId, row.assetTypeId);
    if (!parents.ok) return parents;
    const same = await tx.equipment.findByInternalCode(row.tenantId, row.supplierId, nameKey(row.internalCode));
    return same === null || same.id === row.id ? ok(undefined) : internalCodeTaken(row.internalCode);
  },
  store: async (tx, row, archivedAt) =>
    equipmentOutcome(await tx.equipment.setArchivedAt(row.tenantId, row.id, archivedAt), row, archivedAt),
};
