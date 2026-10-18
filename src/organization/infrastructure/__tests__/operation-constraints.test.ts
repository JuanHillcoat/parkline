import { describe, expect, it } from "vitest";
import { operationConflictOf } from "../postgres-organization-repositories";

describe("operationConflictOf", () => {
  it("maps the two known unique constraints of operations to their typed conflicts", () => {
    expect(operationConflictOf("operations_tenant_id_business_unit_id_name_key_key")).toBe("name_taken");
    expect(operationConflictOf("operations_tenant_id_cost_center_key")).toBe("cost_center_taken");
  });

  it.each([["operations_pkey"], ["operations_tenant_id_id_key"], ["some_other_cost_center_index"], [""], [undefined]])(
    "does not recognize %s, so the caller rethrows",
    (constraint) => {
      expect(operationConflictOf(constraint)).toBeNull();
    },
  );
});
