import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import {
  buildScopeOptions,
  grantText,
  initialSelection,
  rawScopeFrom,
  scopeValue,
  withDivision,
  withKind,
  withRole,
  type ScopeSelection,
} from "../user-scope";

const GONE = new Date("2026-01-01T00:00:00Z");
const unit = (id: string, name: string, archivedAt: Date | null = null) => ({ id, tenantId: "t", name, archivedAt });
const op = (id: string, businessUnitId: string, costCenter: string, name: string, archivedAt: Date | null = null) => ({
  id,
  tenantId: "t",
  businessUnitId,
  siteId: "s1",
  costCenter,
  name,
  archivedAt,
});

const options = buildScopeOptions(
  [unit("d2", "ZETA"), unit("d1", "ALFA"), unit("d3", "OLD", GONE)],
  [op("o2", "d1", "0060", "SEGUNDA"), op("o1", "d1", "0050", "PRIMERA"), op("o3", "d1", "0070", "VIEJA", GONE), op("o4", "d3", "0080", "HUERFANA")],
);

describe("buildScopeOptions", () => {
  it("offers active divisions sorted by name", () => {
    expect(options.divisions.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("offers active operations of offered divisions sorted by cost center", () => {
    expect(options.operations).toEqual([
      { id: "o1", name: "PRIMERA", costCenter: "0050", businessUnitId: "d1" },
      { id: "o2", name: "SEGUNDA", costCenter: "0060", businessUnitId: "d1" },
    ]);
  });
});

describe("initialSelection", () => {
  it("defaults to the whole company", () => {
    expect(initialSelection("viewer", undefined, options)).toEqual({
      role: "viewer", kind: "tenant", divisionId: "", operationId: "",
    });
  });

  it("preselects a division scope", () => {
    expect(initialSelection("manager", { scopeType: "business_unit", scopeId: "d2" }, options)).toEqual({
      role: "manager", kind: "business_unit", divisionId: "d2", operationId: "",
    });
  });

  it("preselects an operation scope with its division", () => {
    expect(initialSelection("manager", { scopeType: "operation", scopeId: "o2" }, options)).toEqual({
      role: "manager", kind: "operation", divisionId: "d1", operationId: "o2",
    });
  });

  it("keeps a company grant as the company", () => {
    expect(initialSelection("manager", { scopeType: "tenant", scopeId: "t" }, options).kind).toBe("tenant");
  });

  it("never turns a scope that is not offered into the company", () => {
    const gone = { scopeType: "operation", scopeId: "gone" };
    const site = { scopeType: "site", scopeId: "s1" };
    const archivedDivision = { scopeType: "business_unit", scopeId: "d3" };
    for (const current of [gone, site, archivedDivision]) {
      const selection = initialSelection("manager", current, options);
      expect(selection).toEqual({ role: "manager", kind: "unresolved", divisionId: "", operationId: "" });
      expect(scopeValue(selection)).toEqual({ type: "", id: "" });
    }
  });
});

describe("selection transitions", () => {
  const manager: ScopeSelection = { role: "manager", kind: "operation", divisionId: "d1", operationId: "o1" };

  it("forces the company scope for admin and keeps the choice for other roles", () => {
    expect(withRole(manager, "admin")).toMatchObject({ role: "admin", kind: "tenant" });
    expect(withRole(manager, "viewer")).toMatchObject({ role: "viewer", kind: "operation", operationId: "o1" });
  });

  it("clears the operation when the division changes", () => {
    expect(withDivision(manager, "d2")).toMatchObject({ divisionId: "d2", operationId: "" });
  });

  it("changing the level keeps the division and clears the operation", () => {
    expect(withKind(manager, "business_unit")).toMatchObject({ kind: "business_unit", divisionId: "d1", operationId: "" });
  });

  it("submits the id that belongs to the level", () => {
    expect(scopeValue(manager)).toEqual({ type: "operation", id: "o1" });
    expect(scopeValue({ ...manager, kind: "business_unit" })).toEqual({ type: "business_unit", id: "d1" });
    expect(scopeValue({ ...manager, kind: "tenant" })).toEqual({ type: "tenant", id: "" });
  });
});

describe("rawScopeFrom", () => {
  it("applies the tenant id on the server for the company scope", () => {
    expect(rawScopeFrom("tenant", "", "t1")).toEqual({ type: "tenant", id: "t1" });
  });

  it("returns nothing when the level is missing, so the company is never assumed", () => {
    expect(rawScopeFrom("", "ignored", "t1")).toBeNull();
  });

  it("passes any other value through for the use case to validate", () => {
    expect(rawScopeFrom("operation", "o1", "t1")).toEqual({ type: "operation", id: "o1" });
    expect(rawScopeFrom("bogus", "x", "t1")).toEqual({ type: "bogus", id: "x" });
  });
});

describe("grantText", () => {
  const base = { role: "manager" as const, scopeType: "business_unit", scopeId: "d1" };

  it("joins the role and the scope name", () => {
    expect(grantText({ ...base, scopeLabel: { name: "AUTOMOTRIZ", archived: false } })).toBe("Gerente · AUTOMOTRIZ");
  });

  it("names the whole company for the tenant scope", () => {
    expect(grantText({ role: "viewer", scopeType: "tenant", scopeId: "t1", scopeLabel: null })).toBe(
      `Visualizador · ${copy.scope.company}`,
    );
  });

  it("marks an archived scope", () => {
    expect(grantText({ ...base, scopeLabel: { name: "AUTOMOTRIZ", archived: true } })).toBe(
      `Gerente · AUTOMOTRIZ ${copy.scope.archived}`,
    );
  });

  it("does not crash when the scope has no label", () => {
    expect(grantText({ ...base, scopeLabel: null })).toBe(`Gerente · ${copy.scope.unknown}`);
  });
});
