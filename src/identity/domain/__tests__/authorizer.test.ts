import { describe, expect, it } from "vitest";
import { authorize } from "../authorizer";
import type { Permission } from "../permission";
import type { Role } from "../role";
import type { RoleAssignment } from "../role-assignment";
import type { ResourceScope, Scope } from "../scope";
import type { User } from "../user";

const user: User = {
  id: "user-1",
  tenantId: "tenant-a",
  email: "ana@example.test",
  displayName: "Ana Test",
  active: true,
};

const site1: ResourceScope = {
  tenantId: "tenant-a",
  businessUnitId: "bu-1",
  operationId: "op-1",
  siteId: "site-1",
};

const assign = (role: Role, scope: Scope, active = true): RoleAssignment => ({
  userId: "user-1",
  role,
  scope,
  active,
});

const codeOf = (result: ReturnType<typeof authorize>): string | null =>
  result.ok ? null : result.error.code;

const run = (
  assignments: RoleAssignment[],
  permission: Permission,
  resource: ResourceScope = site1,
  who: User = user,
) => authorize({ user: who, assignments, permission, resource });

describe("authorize", () => {
  it("allows an admin with tenant scope on any site of its tenant", () => {
    const admin = assign("admin", { type: "tenant", id: "tenant-a" });
    expect(run([admin], "role.assign").ok).toBe(true);
    expect(run([admin], "user.create", { tenantId: "tenant-a", siteId: "site-9" }).ok).toBe(true);
  });

  it("denies a supervisor of one site on another site", () => {
    const supervisor = assign("supervisor", { type: "site", id: "site-1" });
    expect(run([supervisor], "catalog.read").ok).toBe(true);
    const other: ResourceScope = { ...site1, siteId: "site-2" };
    expect(codeOf(run([supervisor], "catalog.read", other))).toBe("forbidden");
  });

  it("denies a viewer from assigning roles", () => {
    const viewer = assign("viewer", { type: "tenant", id: "tenant-a" });
    expect(codeOf(run([viewer], "role.assign"))).toBe("forbidden");
  });

  it("denies when the tenant differs even with matching scope ids", () => {
    const admin = assign("admin", { type: "tenant", id: "tenant-b" });
    const foreign: ResourceScope = { tenantId: "tenant-b", siteId: "site-1" };
    expect(codeOf(run([admin], "user.read", foreign))).toBe("tenant_mismatch");
  });

  it("denies an inactive user with a distinct code", () => {
    const admin = assign("admin", { type: "tenant", id: "tenant-a" });
    const result = run([admin], "user.read", site1, { ...user, active: false });
    expect(codeOf(result)).toBe("inactive_user");
  });

  it("ignores inactive assignments and assignments of other users", () => {
    const inactive = assign("admin", { type: "tenant", id: "tenant-a" }, false);
    const foreign: RoleAssignment = { ...inactive, userId: "user-2", active: true };
    expect(codeOf(run([inactive, foreign], "user.read"))).toBe("forbidden");
  });

  it("allows when any one assignment grants the permission in scope", () => {
    const viewer = assign("viewer", { type: "tenant", id: "tenant-a" });
    const analyst = assign("fleet_analyst", { type: "operation", id: "op-1" });
    expect(run([viewer, analyst], "catalog.write").ok).toBe(true);
  });

  it("denies when the role grants the permission but the scope does not cover", () => {
    const analyst = assign("fleet_analyst", { type: "operation", id: "op-2" });
    expect(codeOf(run([analyst], "catalog.write"))).toBe("forbidden");
  });

  it("denies with no assignments", () => {
    expect(codeOf(run([], "catalog.read"))).toBe("forbidden");
  });
});
