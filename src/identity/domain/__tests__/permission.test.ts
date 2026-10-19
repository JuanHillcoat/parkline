import { describe, expect, it } from "vitest";
import { PERMISSIONS, ROLE_PERMISSIONS, roleGrants } from "../permission";
import { ROLES } from "../role";

describe("role permissions", () => {
  it("defines permissions for every role", () => {
    for (const role of ROLES) expect(ROLE_PERMISSIONS[role]).toBeDefined();
  });

  it("grants admin every permission except archiving catalog rows", () => {
    for (const permission of PERMISSIONS.filter((p) => p !== "catalog.archive")) {
      expect(roleGrants("admin", permission)).toBe(true);
    }
  });

  it("grants catalog.archive to the fleet analyst only", () => {
    expect(roleGrants("fleet_analyst", "catalog.archive")).toBe(true);
    for (const role of ["admin", "manager", "supervisor", "viewer"] as const) {
      expect(roleGrants(role, "catalog.archive")).toBe(false);
    }
  });

  it("lets a manager read users and audit but not assign roles", () => {
    expect(roleGrants("manager", "user.read")).toBe(true);
    expect(roleGrants("manager", "audit.read")).toBe(true);
    expect(roleGrants("manager", "role.assign")).toBe(false);
  });

  it("lets a fleet analyst write the catalog only", () => {
    expect(roleGrants("fleet_analyst", "catalog.write")).toBe(true);
    expect(roleGrants("fleet_analyst", "user.create")).toBe(false);
  });

  it("keeps supervisor and viewer read-only", () => {
    for (const role of ["supervisor", "viewer"] as const) {
      expect(roleGrants(role, "catalog.read")).toBe(true);
      expect(roleGrants(role, "catalog.write")).toBe(false);
      expect(roleGrants(role, "role.assign")).toBe(false);
    }
  });

  it("denies supervisor and viewer user management and audit access", () => {
    for (const role of ["supervisor", "viewer"] as const) {
      for (const permission of ["user.create", "user.deactivate", "audit.read"] as const) {
        expect(roleGrants(role, permission)).toBe(false);
      }
    }
  });
});
