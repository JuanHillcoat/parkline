import { describe, expect, it } from "vitest";
import type { Actor, Grant } from "../../../shared/domain/ports/access-policy";
import type { ResourcePosition } from "../../../shared/domain/ports/access-policy";
import { ForbiddenError } from "../../../shared/domain/domain-error";
import type { Role } from "../../domain/role";
import type { RoleAssignment } from "../../domain/role-assignment";
import type { Scope } from "../../domain/scope";
import type { User } from "../../domain/user";
import { toActor } from "../actor-mapper";
import type { ActorContext } from "../actor-context";
import { IdentityAccessPolicy } from "../identity-access-policy";

const user: User = {
  id: "user-1",
  tenantId: "tenant-a",
  email: "ana@example.test",
  displayName: "Ana Test",
  active: true,
};

const assign = (role: Role, scope: Scope, active = true): RoleAssignment => ({
  userId: "user-1",
  role,
  scope,
  active,
});

const actorOf = (assignments: RoleAssignment[], who: User = user): Actor =>
  toActor({ user: who, assignments });

const policy = new IdentityAccessPolicy();
const tenantA: ResourcePosition = { tenantId: "tenant-a" };
const site: ResourcePosition = {
  tenantId: "tenant-a",
  businessUnitId: "bu-1",
  operationId: "op-1",
  siteId: "site-1",
};

describe("IdentityAccessPolicy", () => {
  it("grants by tenant scope and returns the granting role", () => {
    const actor = actorOf([assign("fleet_analyst", { type: "tenant", id: "tenant-a" })]);
    const result = policy.check(actor, "catalog.write", tenantA);
    expect(result).toEqual({ ok: true, value: "fleet_analyst" });
  });

  it("denies a viewer on catalog.write with a shared forbidden error", () => {
    const actor = actorOf([assign("viewer", { type: "tenant", id: "tenant-a" })]);
    const result = policy.check(actor, "catalog.write", tenantA);
    expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
  });

  it("denies a resource of another tenant", () => {
    const actor = actorOf([assign("admin", { type: "tenant", id: "tenant-a" })]);
    const result = policy.check(actor, "catalog.read", { tenantId: "tenant-b" });
    expect(!result.ok && result.error.code).toBe("tenant_mismatch");
  });

  it("denies an inactive user", () => {
    const actor = actorOf([assign("admin", { type: "tenant", id: "tenant-a" })], {
      ...user,
      active: false,
    });
    const result = policy.check(actor, "catalog.read", tenantA);
    expect(!result.ok && result.error.code).toBe("inactive_user");
  });

  it("ignores inactive assignments", () => {
    const actor = actorOf([assign("admin", { type: "tenant", id: "tenant-a" }, false)]);
    expect(policy.check(actor, "catalog.read", tenantA).ok).toBe(false);
  });

  it.each([
    ["business_unit", "bu-1", true],
    ["operation", "op-1", true],
    ["site", "site-1", true],
    ["business_unit", "bu-2", false],
    ["operation", "op-2", false],
    ["site", "site-2", false],
  ] as const)("%s scope %s covers the position: %s", (type, id, covered) => {
    const actor = actorOf([assign("fleet_analyst", { type, id })]);
    expect(policy.check(actor, "catalog.write", site).ok).toBe(covered);
  });

  it("returns the role that actually grants when several assignments exist", () => {
    const actor = actorOf([
      assign("viewer", { type: "tenant", id: "tenant-a" }),
      assign("fleet_analyst", { type: "operation", id: "op-1" }),
    ]);
    const result = policy.check(actor, "catalog.write", site);
    expect(result).toEqual({ ok: true, value: "fleet_analyst" });
  });

  it("denies an unknown permission and ignores unknown roles or scope types", () => {
    const grants: Grant[] = [{ role: "ghost", scopeType: "tenant", scopeId: "tenant-a" }];
    const actor: Actor = { userId: "user-1", tenantId: "tenant-a", active: true, grants };
    expect(policy.check(actor, "catalog.read", tenantA).ok).toBe(false);
    const admin = actorOf([assign("admin", { type: "tenant", id: "tenant-a" })]);
    expect(policy.check(admin, "made.up", tenantA).ok).toBe(false);
  });
});

describe("toActor", () => {
  it("keeps only active assignments of the user and drops identity types", () => {
    const context: ActorContext = {
      user,
      assignments: [
        assign("manager", { type: "business_unit", id: "bu-1" }),
        assign("admin", { type: "tenant", id: "tenant-a" }, false),
        { ...assign("viewer", { type: "tenant", id: "tenant-a" }), userId: "user-2" },
      ],
    };
    expect(toActor(context)).toEqual({
      userId: "user-1",
      tenantId: "tenant-a",
      active: true,
      grants: [{ role: "manager", scopeType: "business_unit", scopeId: "bu-1" }],
    });
  });
});
