import type { ScopeLabel } from "../../shared/domain/ports/scope-directory";

/** Scope types the organization module can label (the same strings identity uses for scopes). */
export const LABELED_TYPES = ["business_unit", "operation", "site"] as const;
export type LabeledType = (typeof LABELED_TYPES)[number];

export const isLabeledType = (type: string): type is LabeledType => (LABELED_TYPES as readonly string[]).includes(type);

/**
 * The label of an operation reads like its name with its cost center ("0050 NAME"), so the users
 * table identifies it without opening the organization screen. Divisions and sites use the name.
 */
export const scopeLabel = (
  type: LabeledType,
  row: { name: string; costCenter?: string; archivedAt: Date | null },
): ScopeLabel => ({
  name: type === "operation" && row.costCenter !== undefined ? `${row.costCenter} ${row.name}` : row.name,
  archived: row.archivedAt !== null,
});
