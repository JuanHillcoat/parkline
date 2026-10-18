import { describe, expect, it } from "vitest";
import type { ActorContext } from "../../../src/identity/application/actor-context";
import { canReadCatalog } from "../catalog-access";

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
