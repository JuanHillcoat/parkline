import { describe, expect, it } from "vitest";
import { createRoleAssignment } from "../role-assignment";

describe("createRoleAssignment", () => {
  it("creates an active assignment", () => {
    const result = createRoleAssignment({
      userId: "user-1",
      role: "supervisor",
      scope: { type: "site", id: "site-1" },
    });
    expect(result).toEqual({
      ok: true,
      value: { userId: "user-1", role: "supervisor", scope: { type: "site", id: "site-1" }, active: true },
    });
  });

  it("accepts admin with tenant scope", () => {
    const result = createRoleAssignment({
      userId: "user-1",
      role: "admin",
      scope: { type: "tenant", id: "tenant-a" },
    });
    expect(result.ok).toBe(true);
  });

  it("rejects admin with a non-tenant scope", () => {
    const result = createRoleAssignment({
      userId: "user-1",
      role: "admin",
      scope: { type: "site", id: "site-1" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("admin_requires_tenant_scope");
  });

  it("rejects empty ids", () => {
    const noUser = createRoleAssignment({
      userId: " ",
      role: "viewer",
      scope: { type: "tenant", id: "tenant-a" },
    });
    const noScope = createRoleAssignment({
      userId: "user-1",
      role: "viewer",
      scope: { type: "tenant", id: "" },
    });
    expect(noUser.ok).toBe(false);
    expect(noScope.ok).toBe(false);
    if (!noUser.ok) expect(noUser.error.code).toBe("validation");
  });
});
