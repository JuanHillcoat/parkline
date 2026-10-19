import { describe, expect, it } from "vitest";
import type { Actor, Grant } from "../../../shared/domain/ports/access-policy";
import { FakeAccessPolicy } from "../../__tests__/support/fake-access-policy";
import type { BusinessUnit, Operation, Site } from "../entities";
import { visibleBusinessUnits, visibleOperations, visibleSites, type CanRead } from "../visibility";

// Synthetic world. Tenant A: Division A {Operation A1 at Site A1, Operation A2
// at Site A2}, Division B {Operation B1 at Site A2: two operations share a
// site}; Site A3 has no operation. Tenant B repeats the shape with other ids.
const bu = (id: string, tenantId = "t-a"): BusinessUnit => ({ id, tenantId, name: id, archivedAt: null });
const op = (id: string, businessUnitId: string, siteId: string, costCenter: string, tenantId = "t-a"): Operation => ({
  id,
  tenantId,
  businessUnitId,
  siteId,
  name: id,
  costCenter,
  archivedAt: null,
});
const site = (id: string, tenantId = "t-a"): Site => ({ id, tenantId, name: id, archivedAt: null });

const units = [bu("div-a"), bu("div-b"), bu("div-x", "t-b")];
const operations = [
  op("op-a1", "div-a", "site-a1", "0001"),
  op("op-a2", "div-a", "site-a2", "0002"),
  op("op-b1", "div-b", "site-a2", "0003"),
  op("op-x", "div-x", "site-x", "0001", "t-b"),
];
const sites = [site("site-a1"), site("site-a2"), site("site-a3"), site("site-x", "t-b")];

const policy = new FakeAccessPolicy();
const canReadAs =
  (...grants: Grant[]): CanRead =>
  (position) => {
    const actor: Actor = { userId: "u", tenantId: "t-a", active: true, grants };
    return policy.check(actor, "catalog.read", position).ok;
  };

const grant = (scopeType: string, scopeId: string): Grant => ({ role: "viewer", scopeType, scopeId });
const ids = (items: readonly { id: string }[]): string[] => items.map((item) => item.id);

const see = (...grants: Grant[]) => {
  const canRead = canReadAs(...grants);
  return {
    units: ids(visibleBusinessUnits(units, canRead)),
    operations: ids(visibleOperations(operations, canRead)),
    sites: ids(visibleSites(sites, operations, canRead)),
  };
};

describe("visibility (D4)", () => {
  it("tenant scope sees everything of its tenant and nothing of another", () => {
    expect(see(grant("tenant", "t-a"))).toEqual({
      units: ["div-a", "div-b"],
      operations: ["op-a1", "op-a2", "op-b1"],
      sites: ["site-a1", "site-a2", "site-a3"],
    });
  });

  it("division scope sees its division, its operations and their sites, not the other division", () => {
    expect(see(grant("business_unit", "div-a"))).toEqual({
      units: ["div-a"],
      operations: ["op-a1", "op-a2"],
      sites: ["site-a1", "site-a2"],
    });
  });

  it("operation scope sees itself and its site, not its siblings, its division or unrelated sites", () => {
    expect(see(grant("operation", "op-a1"))).toEqual({ units: [], operations: ["op-a1"], sites: ["site-a1"] });
  });

  it("operation scope sees a shared site but not the other operation at it", () => {
    expect(see(grant("operation", "op-b1"))).toEqual({ units: [], operations: ["op-b1"], sites: ["site-a2"] });
  });

  it("site scope sees the site and every operation located at it, across divisions", () => {
    expect(see(grant("site", "site-a2"))).toEqual({
      units: [],
      operations: ["op-a2", "op-b1"],
      sites: ["site-a2"],
    });
  });

  it("a site without operations is seen only through its own scope", () => {
    expect(see(grant("site", "site-a3"))).toEqual({ units: [], operations: [], sites: ["site-a3"] });
  });

  it("several grants add up", () => {
    expect(see(grant("operation", "op-a1"), grant("site", "site-a3")).sites).toEqual(["site-a1", "site-a3"]);
  });

  it("no grants, or grants over another tenant's nodes, see nothing", () => {
    const nothing = { units: [], operations: [], sites: [] };
    expect(see()).toEqual(nothing);
    expect(see(grant("operation", "op-x"), grant("site", "site-x"), grant("business_unit", "div-x"))).toEqual(nothing);
  });
});
