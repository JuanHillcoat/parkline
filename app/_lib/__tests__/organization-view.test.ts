import { describe, expect, it } from "vitest";
import {
  buildDivisionGroups,
  buildSiteRows,
  countActiveOperationsBySite,
  archivedToggleHref,
  siteNamesById,
  wantsArchived,
} from "../organization-view";

const GONE = new Date("2026-01-01T00:00:00Z");
const unit = (id: string, name: string, archivedAt: Date | null = null) => ({ id, tenantId: "t", name, archivedAt });
const site = (id: string, name: string, archivedAt: Date | null = null) => ({ id, tenantId: "t", name, archivedAt });
const op = (
  id: string,
  businessUnitId: string,
  siteId: string,
  costCenter: string,
  name: string,
  archivedAt: Date | null = null,
) => ({
  id,
  tenantId: "t",
  businessUnitId,
  siteId,
  costCenter,
  name,
  archivedAt,
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

describe("countActiveOperationsBySite", () => {
  it("counts the operations located at each site", () => {
    const counts = countActiveOperationsBySite(operations);
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
      { id: "u9", name: "Empty", archived: false, activeOperations: 0, operations: [] },
    ]);
  });

  it("puts operations whose division is not visible in one unnamed group at the end", () => {
    const groups = buildDivisionGroups([], operations.slice(0, 1), siteNamesById(sites));
    expect(groups).toEqual([
      {
        id: null,
        name: null,
        archived: false,
        activeOperations: 1,
        operations: [
          {
            id: "o1",
            name: "Mine 1",
            businessUnitId: "u1",
            siteId: "s2",
            costCenter: "0050",
            siteName: "Depot",
            archived: false,
          },
        ],
      },
    ]);
  });

  it("leaves the site name null when the site is not in the list", () => {
    const groups = buildDivisionGroups(units, operations, new Map());
    expect(groups[0]?.operations[0]?.siteName).toBeNull();
  });
});

describe("archived rows", () => {
  const archivedOp = op("o9", "u1", "s1", "0070", "Old", GONE);

  it("marks archived divisions and operations and counts only the active operations", () => {
    const groups = buildDivisionGroups([unit("u1", "North"), unit("u3", "Closed", GONE)], [...operations.slice(0, 2), archivedOp], new Map());
    expect(groups.map((g) => [g.name, g.archived, g.activeOperations, g.operations.length])).toEqual([
      ["North", false, 2, 3],
      ["Closed", true, 0, 0],
    ]);
    expect(groups[0]?.operations.map((o) => o.archived)).toEqual([false, false, true]);
  });

  it("counts only active operations per site and marks archived sites", () => {
    const rows = buildSiteRows([site("s1", "Yard"), site("s4", "Gone", GONE)], [...operations, archivedOp]);
    expect(rows.map((r) => [r.name, r.archived, r.operationCount])).toEqual([
      ["Yard", false, 2],
      ["Gone", true, 0],
    ]);
  });

  it("does not count archived operations in countActiveOperationsBySite", () => {
    expect(countActiveOperationsBySite([...operations, archivedOp]).get("s1")).toBe(2);
  });
});

describe("the archived view toggle", () => {
  it("is on only for the exact flag value", () => {
    expect(wantsArchived("1")).toBe(true);
    expect(wantsArchived(undefined)).toBe(false);
    expect(wantsArchived("0")).toBe(false);
    expect(wantsArchived(["1", "1"])).toBe(false);
  });

  it("links to the other view", () => {
    expect(archivedToggleHref(false)).toBe("/organization?archived=1");
    expect(archivedToggleHref(true)).toBe("/organization");
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
