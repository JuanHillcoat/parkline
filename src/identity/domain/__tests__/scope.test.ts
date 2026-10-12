import { describe, expect, it } from "vitest";
import { scopeCovers, type ResourceScope } from "../scope";

const site: ResourceScope = {
  tenantId: "tenant-a",
  businessUnitId: "bu-1",
  operationId: "op-1",
  siteId: "site-1",
};

describe("scopeCovers", () => {
  it("covers every resource of the tenant with a tenant scope", () => {
    expect(scopeCovers({ type: "tenant", id: "tenant-a" }, site, "tenant-a")).toBe(true);
    const tenantOnly: ResourceScope = { tenantId: "tenant-a" };
    expect(scopeCovers({ type: "tenant", id: "tenant-a" }, tenantOnly, "tenant-a")).toBe(true);
  });

  it("matches business unit, operation and site by their own id", () => {
    expect(scopeCovers({ type: "business_unit", id: "bu-1" }, site, "tenant-a")).toBe(true);
    expect(scopeCovers({ type: "operation", id: "op-1" }, site, "tenant-a")).toBe(true);
    expect(scopeCovers({ type: "site", id: "site-1" }, site, "tenant-a")).toBe(true);
  });

  it("does not cover a different node of the same level", () => {
    expect(scopeCovers({ type: "site", id: "site-2" }, site, "tenant-a")).toBe(false);
    expect(scopeCovers({ type: "operation", id: "op-2" }, site, "tenant-a")).toBe(false);
  });

  it("does not match an id against a different level", () => {
    expect(scopeCovers({ type: "operation", id: "site-1" }, site, "tenant-a")).toBe(false);
  });

  it("does not cover when the resource lacks the scoped level", () => {
    const tenantOnly: ResourceScope = { tenantId: "tenant-a" };
    expect(scopeCovers({ type: "site", id: "site-1" }, tenantOnly, "tenant-a")).toBe(false);
    expect(scopeCovers({ type: "business_unit", id: "bu-1" }, tenantOnly, "tenant-a")).toBe(false);
  });

  it("always denies across tenants, even with a matching id", () => {
    const other: ResourceScope = { ...site, tenantId: "tenant-b" };
    expect(scopeCovers({ type: "site", id: "site-1" }, other, "tenant-a")).toBe(false);
    expect(scopeCovers({ type: "tenant", id: "tenant-b" }, other, "tenant-a")).toBe(false);
  });
});
