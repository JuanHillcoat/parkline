import { describe, expect, it } from "vitest";
import type { Actor, Grant } from "../../../shared/domain/ports/access-policy";
import { FakeAccessPolicy } from "../../__tests__/support/fake-access-policy";
import type { BusinessUnit, Operation, OperationSite, Site } from "../entities";
import { visibleBusinessUnits, visibleOperations, visibleSites, type CanRead } from "../visibility";

// Synthetic world. Tenant A: bu-1 {op-1, op-2}, bu-2 {op-3}; sites s-1 (op-1),
// s-2 (op-2 and op-3), s-3 (unlinked). Tenant B repeats the shape with other ids.
const bu = (id: string, tenantId = "t-a"): BusinessUnit => ({ id, tenantId, name: id });
const op = (id: string, businessUnitId: string, tenantId = "t-a"): Operation => ({
  id,
  tenantId,
  businessUnitId,
  name: id,
});
const site = (id: string, tenantId = "t-a"): Site => ({ id, tenantId, name: id });
const link = (operationId: string, siteId: string, tenantId = "t-a"): OperationSite => ({
  tenantId,
  operationId,
  siteId,
});

const units = [bu("bu-1"), bu("bu-2"), bu("bu-x", "t-b")];
const operations = [op("op-1", "bu-1"), op("op-2", "bu-1"), op("op-3", "bu-2"), op("op-x", "bu-x", "t-b")];
const sites = [site("s-1"), site("s-2"), site("s-3"), site("s-x", "t-b")];
const links = [link("op-1", "s-1"), link("op-2", "s-2"), link("op-3", "s-2"), link("op-x", "s-x", "t-b")];

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
    operations: ids(visibleOperations(operations, links, canRead)),
    sites: ids(visibleSites(sites, operations, links, canRead)),
  };
};

describe("visibility (D4)", () => {
  it("tenant scope sees everything of its tenant and nothing of another", () => {
    expect(see(grant("tenant", "t-a"))).toEqual({
      units: ["bu-1", "bu-2"],
      operations: ["op-1", "op-2", "op-3"],
      sites: ["s-1", "s-2", "s-3"],
    });
  });

  it("business unit scope sees its unit, its operations and the sites linked to them", () => {
    expect(see(grant("business_unit", "bu-1"))).toEqual({
      units: ["bu-1"],
      operations: ["op-1", "op-2"],
      sites: ["s-1", "s-2"],
    });
  });

  it("operation scope sees itself and its sites, not its siblings, its unit or unrelated sites", () => {
    expect(see(grant("operation", "op-1"))).toEqual({ units: [], operations: ["op-1"], sites: ["s-1"] });
  });

  it("operation scope sees a site shared with other operations but not those operations", () => {
    expect(see(grant("operation", "op-3"))).toEqual({ units: [], operations: ["op-3"], sites: ["s-2"] });
  });

  it("site scope sees the site and every operation linked to it", () => {
    expect(see(grant("site", "s-2"))).toEqual({ units: [], operations: ["op-2", "op-3"], sites: ["s-2"] });
  });

  it("an unlinked site is seen only through its own scope", () => {
    expect(see(grant("site", "s-3"))).toEqual({ units: [], operations: [], sites: ["s-3"] });
  });

  it("several grants add up", () => {
    expect(see(grant("operation", "op-1"), grant("site", "s-3")).sites).toEqual(["s-1", "s-3"]);
  });

  it("no grants, or grants over another tenant's nodes, see nothing", () => {
    const nothing = { units: [], operations: [], sites: [] };
    expect(see()).toEqual(nothing);
    expect(see(grant("operation", "op-x"), grant("site", "s-x"), grant("business_unit", "bu-x"))).toEqual(nothing);
  });
});
