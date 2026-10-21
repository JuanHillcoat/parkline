import { describe, expect, it } from "vitest";
import type { Equipment } from "../../../src/fleet/domain/entities";
import { buildKpis, countActive, distribute, hasNoData } from "../dashboard-view";

const GONE = new Date("2026-01-01T00:00:00Z");
const unit = (id: string, supplierId: string, assetTypeId: string, archivedAt: Date | null = null): Equipment => ({
  id,
  tenantId: "t",
  supplierId,
  assetTypeId,
  internalCode: id,
  brand: null,
  model: null,
  year: null,
  serialNumber: null,
  batteryQuantity: null,
  observations: null,
  archivedAt,
});
const names = (entries: readonly (readonly [string, string])[]) => new Map(entries);
const OTHERS = "Otros";

describe("countActive", () => {
  it("counts only the rows that are not archived", () => {
    expect(countActive([{ archivedAt: null }, { archivedAt: GONE }, { archivedAt: null }])).toBe(2);
  });

  it("is zero for an empty list", () => {
    expect(countActive([])).toBe(0);
  });
});

describe("distribute", () => {
  it("is empty without equipment", () => {
    expect(distribute([], "supplierId", names([["s1", "ALFA"]]), OTHERS)).toEqual({ total: 0, slices: [] });
  });

  it("ignores archived equipment", () => {
    const result = distribute([unit("e1", "s1", "a1", GONE)], "supplierId", names([["s1", "ALFA"]]), OTHERS);
    expect(result.total).toBe(0);
  });

  it("orders by count descending and breaks ties by label", () => {
    const rows = [unit("e1", "s2", "a"), unit("e2", "s1", "a"), unit("e3", "s3", "a"), unit("e4", "s3", "a")];
    const result = distribute(rows, "supplierId", names([["s1", "BETA"], ["s2", "ALFA"], ["s3", "GAMMA"]]), OTHERS);
    expect(result.slices.map((s) => [s.label, s.count])).toEqual([["GAMMA", 2], ["ALFA", 1], ["BETA", 1]]);
  });

  it("keeps the top five and groups the rest under others", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const rows = ids.flatMap((id, i) => Array.from({ length: 10 - i }, (_, n) => unit(`${id}${String(n)}`, id, "t")));
    const result = distribute(rows, "supplierId", names(ids.map((id) => [id, id.toUpperCase()] as const)), OTHERS);
    expect(result.slices.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", OTHERS]);
    expect(result.slices[5]).toMatchObject({ count: 5 + 4, isOther: true });
  });

  it("adds no others entry when there are five or fewer groups", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id) => unit(id, id, "t"));
    const result = distribute(rows, "supplierId", names(["a", "b", "c", "d", "e"].map((id) => [id, id] as const)), OTHERS);
    expect(result.slices.some((s) => s.isOther)).toBe(false);
  });

  it("counts equipment whose group is not in the names under others", () => {
    const result = distribute([unit("e1", "s1", "a"), unit("e2", "ghost", "a")], "supplierId", names([["s1", "ALFA"]]), OTHERS);
    expect(result.slices.map((s) => [s.label, s.count])).toEqual([["ALFA", 1], [OTHERS, 1]]);
  });

  it("gives percentages that always add up to one hundred", () => {
    const rows = [unit("e1", "a", "t"), unit("e2", "b", "t"), unit("e3", "c", "t")];
    const result = distribute(rows, "supplierId", names([["a", "A"], ["b", "B"], ["c", "C"]]), OTHERS);
    expect(result.slices.map((s) => s.percent)).toEqual([34, 33, 33]);
    expect(result.slices.reduce((sum, s) => sum + s.percent, 0)).toBe(100);
  });

  it("gives one hundred percent to a single group", () => {
    const result = distribute([unit("e1", "a", "t")], "assetTypeId", names([["t", "GRUA"]]), OTHERS);
    expect(result.slices).toEqual([{ label: "GRUA", count: 1, percent: 100, isOther: false }]);
  });
});

describe("buildKpis", () => {
  it("keeps the fixed order and skips the counts that are not available", () => {
    const kpis = buildKpis({ sites: 2, equipment: 5 });
    expect(kpis.map((k) => [k.key, k.count])).toEqual([["equipment", 5], ["sites", 2]]);
  });

  it("links fleet counts to the fleet and structure counts to the organization", () => {
    const hrefs = buildKpis({ equipment: 0, suppliers: 0, assetTypes: 0, divisions: 0, operations: 0, sites: 0 }).map((k) => k.href);
    expect(hrefs).toEqual(["/fleet", "/fleet", "/fleet", "/organization", "/organization", "/organization"]);
  });
});

describe("hasNoData", () => {
  it("is true when every available count is zero", () => {
    expect(hasNoData(buildKpis({ equipment: 0, divisions: 0 }))).toBe(true);
  });

  it("is false as soon as one count is positive", () => {
    expect(hasNoData(buildKpis({ equipment: 0, divisions: 1 }))).toBe(false);
  });

  it("is false when nothing could be read, so no first steps are shown", () => {
    expect(hasNoData(buildKpis({}))).toBe(false);
  });
});
