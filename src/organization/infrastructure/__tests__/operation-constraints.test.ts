import { describe, expect, it } from "vitest";
import { archiveConflictOf, operationConflictOf } from "../postgres-organization-repositories";

const OPERATION_NAME = "operations_active_name_key";
const OPERATION_COST_CENTER = "operations_active_cost_center_key";

describe("operationConflictOf", () => {
  it("maps the two partial unique indexes of operations to their typed conflicts", () => {
    expect(operationConflictOf(OPERATION_NAME)).toBe("name_taken");
    expect(operationConflictOf(OPERATION_COST_CENTER)).toBe("cost_center_taken");
  });

  it.each([
    ["operations_pkey"],
    ["operations_tenant_id_id_key"],
    ["business_units_active_name_key"],
    ["operations_tenant_id_cost_center_key"],
    ["some_other_cost_center_index"],
    [""],
    [undefined],
  ])("does not recognize %s, so the caller rethrows", (constraint) => {
    expect(operationConflictOf(constraint)).toBeNull();
  });
});

describe("archiveConflictOf", () => {
  it("maps every partial unique index a restore can hit to its typed conflict", () => {
    expect(archiveConflictOf("business_units_active_name_key")).toBe("name_taken");
    expect(archiveConflictOf("sites_active_name_key")).toBe("name_taken");
    expect(archiveConflictOf(OPERATION_NAME)).toBe("name_taken");
    expect(archiveConflictOf(OPERATION_COST_CENTER)).toBe("cost_center_taken");
  });

  it.each([["business_units_pkey"], ["sites_tenant_id_id_key"], ["tmp_unrelated_site_once"], [""], [undefined]])(
    "does not recognize %s, so the caller rethrows",
    (constraint) => {
      expect(archiveConflictOf(constraint)).toBeNull();
    },
  );
});
