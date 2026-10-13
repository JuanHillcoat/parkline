import { describe, expect, it } from "vitest";
import { toAssignment } from "../postgres-rows";

const row = { user_id: "u1", role: "viewer", scope_type: "tenant", scope_id: "t1" };

describe("toAssignment", () => {
  it("maps the stored active flag instead of assuming it", () => {
    expect(toAssignment({ ...row, active: true }).active).toBe(true);
    expect(toAssignment({ ...row, active: false }).active).toBe(false);
  });
});
