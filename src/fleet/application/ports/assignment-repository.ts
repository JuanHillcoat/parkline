import type { Assignment } from "../../domain/assignment";

// Every query takes the tenant id: a row of another tenant is never visible.
// `add` and `update` report the no-overlap rule (the exclusion constraint of the real adapter, D2)
// as a value, not an exception: a concurrent writer took the days first.

/** What `add` and `update` report: stored, or that the period overlaps another assignment of the equipment. */
export type AssignmentWrite = "stored" | "overlap";

export interface AssignmentRepository {
  findById(tenantId: string, id: string): Promise<Assignment | null>;
  /** The assignment of the equipment with no end, if any. */
  findOpen(tenantId: string, equipmentId: string): Promise<Assignment | null>;
  /** Every open assignment of the tenant (one per equipment at most), in no particular order. */
  listOpen(tenantId: string): Promise<readonly Assignment[]>;
  /** Every assignment of the equipment, newest first (by start day, then id). */
  listByEquipment(tenantId: string, equipmentId: string): Promise<readonly Assignment[]>;
  add(assignment: Assignment): Promise<AssignmentWrite>;
  /** Replaces the days, operation, kind and reason of an existing assignment (it must exist). */
  update(assignment: Assignment): Promise<AssignmentWrite>;
}
