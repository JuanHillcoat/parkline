import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../../src/identity/application/actor-context";
import { canReadCatalog, canViewFleet } from "../catalog-access";

const actor = (roles: readonly { role: string; active: boolean }[], active = true): ActorContext =>
  ({
    user: { id: "u", tenantId: "t", active },
    assignments: roles.map((r) => ({ ...r, userId: "u", scope: { type: "operation", id: "o" } })),
  }) as unknown as ActorContext;

describe("canReadCatalog", () => {
  it("is true for any role that reads the catalog, at any scope", () => {
    expect(canReadCatalog(actor([{ role: "viewer", active: true }]))).toBe(true);
    expect(canReadCatalog(actor([{ role: "fleet_analyst", active: true }]))).toBe(true);
  });

  it("is false without active assignments or for an inactive user", () => {
    expect(canReadCatalog(actor([]))).toBe(false);
    expect(canReadCatalog(actor([{ role: "viewer", active: false }]))).toBe(false);
    expect(canReadCatalog(actor([{ role: "viewer", active: true }], false))).toBe(false);
  });
});

const scoped = (type: string, role = "viewer", active = true, userActive = true): ActorContext =>
  ({
    user: { id: "u", tenantId: "t", active: userActive },
    assignments: [{ userId: "u", role, active, scope: { type, id: "x" } }],
  }) as unknown as ActorContext;

describe("canViewFleet", () => {
  it("is true only for a catalog reader with company-wide scope (decision D6)", () => {
    expect(canViewFleet(scoped("tenant"))).toBe(true);
    expect(canViewFleet(scoped("tenant", "fleet_analyst"))).toBe(true);
    expect(canViewFleet(scoped("business_unit"))).toBe(false);
    expect(canViewFleet(scoped("operation"))).toBe(false);
    expect(canViewFleet(scoped("site"))).toBe(false);
  });

  it("is false for an inactive assignment or user, or an empty actor", () => {
    expect(canViewFleet(scoped("tenant", "viewer", false))).toBe(false);
    expect(canViewFleet(scoped("tenant", "viewer", true, false))).toBe(false);
    expect(canViewFleet(actor([]))).toBe(false);
  });
});
