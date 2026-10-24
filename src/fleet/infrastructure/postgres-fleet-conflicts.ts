/**
 * The partial unique indexes of migration 0009 (active rows only) that the adapters report as typed
 * conflicts. Pure functions, so the mapping is unit tested without a database.
 */
export const SUPPLIER_NAME_INDEX = "suppliers_active_name_key";
export const ASSET_TYPE_NAME_INDEX = "asset_types_active_name_key";
export const EQUIPMENT_CODE_INDEX = "equipments_active_internal_code_key";

const UNIQUE_VIOLATION = "23505";

/** The index a unique violation names, or undefined for any other error (and for a 23505 without one). */
export const uniqueViolationIndex = (error: unknown): string | undefined => {
  const { code, constraint_name: constraint } = (error ?? {}) as { code?: string; constraint_name?: string };
  return code === UNIQUE_VIOLATION ? constraint : undefined;
};

/** Suppliers: only the name index is a typed conflict. */
export const supplierConflictOf = (index: string | undefined): "name_taken" | null =>
  index === SUPPLIER_NAME_INDEX ? "name_taken" : null;

/** Asset types: only the name index is a typed conflict. */
export const assetTypeConflictOf = (index: string | undefined): "name_taken" | null =>
  index === ASSET_TYPE_NAME_INDEX ? "name_taken" : null;

/** Equipment: only the internal code index is a typed conflict. */
export const equipmentConflictOf = (index: string | undefined): "internal_code_taken" | null =>
  index === EQUIPMENT_CODE_INDEX ? "internal_code_taken" : null;

/** The no-overlap exclusion constraint of migration 0010 (SQLSTATE 23P01). */
export const ASSIGNMENT_OVERLAP_CONSTRAINT = "equipment_assignments_no_overlap";

const EXCLUSION_VIOLATION = "23P01";

/** The constraint an exclusion violation names, or undefined for any other error. */
export const exclusionViolationConstraint = (error: unknown): string | undefined => {
  const { code, constraint_name: constraint } = (error ?? {}) as { code?: string; constraint_name?: string };
  return code === EXCLUSION_VIOLATION ? constraint : undefined;
};

/** Assignments: only the no-overlap constraint is a typed result. */
export const assignmentWriteOf = (constraint: string | undefined): "overlap" | null =>
  constraint === ASSIGNMENT_OVERLAP_CONSTRAINT ? "overlap" : null;
