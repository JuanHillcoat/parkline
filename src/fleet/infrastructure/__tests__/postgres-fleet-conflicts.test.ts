import { describe, expect, it } from "vitest";
import {
  assetTypeConflictOf,
  assignmentWriteOf,
  equipmentConflictOf,
  exclusionViolationConstraint,
  supplierConflictOf,
  uniqueViolationIndex,
} from "../postgres-fleet-conflicts";

describe("uniqueViolationIndex", () => {
  it("returns the index name of a unique violation", () => {
    expect(uniqueViolationIndex({ code: "23505", constraint_name: "suppliers_active_name_key" })).toBe("suppliers_active_name_key");
  });

  it("ignores any other error, a unique violation without an index name and non-errors", () => {
    expect(uniqueViolationIndex({ code: "23503", constraint_name: "suppliers_active_name_key" })).toBeUndefined();
    expect(uniqueViolationIndex({ code: "23505" })).toBeUndefined();
    expect(uniqueViolationIndex(new Error("boom"))).toBeUndefined();
    expect(uniqueViolationIndex(null)).toBeUndefined();
  });
});

describe("typed conflicts by index name", () => {
  it("maps each table to its own index only", () => {
    expect(supplierConflictOf("suppliers_active_name_key")).toBe("name_taken");
    expect(assetTypeConflictOf("asset_types_active_name_key")).toBe("name_taken");
    expect(equipmentConflictOf("equipments_active_internal_code_key")).toBe("internal_code_taken");
  });

  it("rethrows (null) for the indexes of other tables, primary keys and unknown names", () => {
    for (const index of ["asset_types_active_name_key", "equipments_active_internal_code_key", "suppliers_pkey", undefined]) {
      expect(supplierConflictOf(index)).toBeNull();
    }
    for (const index of ["suppliers_active_name_key", "asset_types_pkey", undefined]) expect(assetTypeConflictOf(index)).toBeNull();
    for (const index of ["suppliers_active_name_key", "equipments_pkey", "organization_x", undefined]) {
      expect(equipmentConflictOf(index)).toBeNull();
    }
  });
});

describe("assignment overlap by constraint name", () => {
  it("reads the constraint of an exclusion violation only (23P01)", () => {
    expect(exclusionViolationConstraint({ code: "23P01", constraint_name: "equipment_assignments_no_overlap" })).toBe(
      "equipment_assignments_no_overlap",
    );
    expect(exclusionViolationConstraint({ code: "23505", constraint_name: "equipment_assignments_no_overlap" })).toBeUndefined();
    expect(exclusionViolationConstraint(new Error("boom"))).toBeUndefined();
    expect(exclusionViolationConstraint(null)).toBeUndefined();
  });

  it("maps only the no-overlap constraint to a typed result", () => {
    expect(assignmentWriteOf("equipment_assignments_no_overlap")).toBe("overlap");
    for (const name of ["equipment_assignments_pkey", "other_exclusion", undefined]) expect(assignmentWriteOf(name)).toBeNull();
  });
});
