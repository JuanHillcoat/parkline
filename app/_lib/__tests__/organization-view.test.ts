import { describe, expect, it } from "vitest";
import {
  buildDivisionGroups,
  buildSiteRows,
  countOperationsBySite,
  siteNamesById,
} from "../organization-view";

const unit = (id: string, name: string) => ({ id, tenantId: "t", name, archivedAt: null });
const site = (id: string, name: string) => ({ id, tenantId: "t", name, archivedAt: null });
const op = (id: string, businessUnitId: string, siteId: string, costCenter: string, name: string) => ({
  id,
  tenantId: "t",
  businessUnitId,
  siteId,
  costCenter,
  name,
  archivedAt: null,
});

const units = [unit("u1", "North"), unit("u2", "South")];
const sites = [site("s1", "Yard"), site("s2", "Depot"), site("s3", "Lot")];
const operations = [
  op("o1", "u1", "s2", "0050", "Mine 1"),
  op("o2", "u1", "s1", "0051", "Mine 2"),
  op("o3", "u2", "s1", "0060", "Plant"),
];

describe("siteNamesById", () => {
  it("maps each site id to its name", () => {
    const names = siteNamesById(sites);
    expect(names.get("s1")).toBe("Yard");
    expect(names.get("s3")).toBe("Lot");
    expect(names.get("missing")).toBeUndefined();
  });
});

describe("countOperationsBySite", () => {
  it("counts the operations located at each site", () => {
    const counts = countOperationsBySite(operations);
    expect(counts.get("s1")).toBe(2);
    expect(counts.get("s2")).toBe(1);
    expect(counts.get("s3")).toBeUndefined();
  });
});

describe("buildDivisionGroups", () => {
  it("groups operations under their division with cost center and site name", () => {
    const groups = buildDivisionGroups(units, operations, siteNamesById(sites));
    expect(groups.map((g) => g.name)).toEqual(["North", "South"]);
    expect(groups[0]?.operations.map((o) => [o.costCenter, o.name, o.siteName])).toEqual([
      ["0050", "Mine 1", "Depot"],
      ["0051", "Mine 2", "Yard"],
    ]);
  });

  it("keeps a division without operations", () => {
    expect(buildDivisionGroups([unit("u9", "Empty")], [], new Map())).toEqual([
      { id: "u9", name: "Empty", operations: [] },
    ]);
  });

  it("puts operations whose division is not visible in one unnamed group at the end", () => {
    const groups = buildDivisionGroups([], operations.slice(0, 1), siteNamesById(sites));
    expect(groups).toEqual([
      {
        id: null,
        name: null,
        operations: [
          { id: "o1", name: "Mine 1", businessUnitId: "u1", siteId: "s2", costCenter: "0050", siteName: "Depot" },
        ],
      },
    ]);
  });

  it("leaves the site name null when the site is not in the list", () => {
    const groups = buildDivisionGroups(units, operations, new Map());
    expect(groups[0]?.operations[0]?.siteName).toBeNull();
  });
});

describe("buildSiteRows", () => {
  it("lists each site with the number of operations located there", () => {
    expect(buildSiteRows(sites, operations).map((r) => [r.name, r.operationCount])).toEqual([
      ["Yard", 2],
      ["Depot", 1],
      ["Lot", 0],
    ]);
  });
});
