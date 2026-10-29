import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { fleetTabOf, initialsOf, isActive, isCurrent, navigationFor, sectionTitle, type NavItem } from "../navigation";

const NONE = { fleet: false, fleetCatalogs: false, users: false, organization: false };
const ALL = { fleet: true, fleetCatalogs: true, users: true, organization: true };

const hrefs = (access: typeof ALL) =>
  navigationFor(access).flatMap((section) => section.items.map((item) => item.href));

describe("navigationFor", () => {
  it("always offers the home entry and nothing else without permissions", () => {
    const sections = navigationFor(NONE);
    expect(sections).toHaveLength(1);
    expect(sections[0]?.items.map((i) => i.href)).toEqual(["/"]);
  });

  it("adds fleet, users and organization only when permitted", () => {
    expect(hrefs({ ...NONE, fleet: true })).toEqual(["/", "/fleet"]);
    expect(hrefs({ ...NONE, users: true })).toEqual(["/", "/users"]);
    expect(hrefs({ ...NONE, organization: true })).toEqual(["/", "/organization"]);
  });

  it("groups administration entries in their own section", () => {
    const sections = navigationFor(ALL);
    expect(sections.map((s) => s.label)).toEqual([copy.nav.main, copy.nav.administration]);
    expect(sections[1]?.items.map((i) => i.href)).toEqual(["/users", "/organization"]);
  });

  it("puts Proveedores and Tipos de equipo right after Flota for company-wide fleet readers", () => {
    expect(hrefs({ ...NONE, fleet: true, fleetCatalogs: true })).toEqual([
      "/",
      "/fleet",
      "/fleet?tab=suppliers",
      "/fleet?tab=asset-types",
    ]);
    expect(navigationFor(ALL)[0]?.items.map((i) => i.label)).toEqual([
      copy.nav.home,
      copy.nav.fleet,
      copy.nav.suppliers,
      copy.nav.assetTypes,
    ]);
  });

  it("offers no catalog entries to a scoped reader (their page has only the equipment tab) or without fleet access", () => {
    expect(hrefs({ ...NONE, fleet: true })).toEqual(["/", "/fleet"]);
    expect(hrefs({ ...NONE, fleetCatalogs: true })).toEqual(["/"]);
  });

  it("never lists entries for functions that do not exist yet", () => {
    expect(hrefs(ALL)).toEqual(["/", "/fleet", "/fleet?tab=suppliers", "/fleet?tab=asset-types", "/users", "/organization"]);
  });
});

describe("sectionTitle", () => {
  it("maps known paths and their children to the section label", () => {
    expect(sectionTitle("/")).toBe(copy.nav.home);
    expect(sectionTitle("/fleet")).toBe(copy.nav.fleet);
    expect(sectionTitle("/fleet/abc")).toBe(copy.nav.fleet);
    expect(sectionTitle("/fleet/equipment/abc")).toBe(copy.nav.fleet);
    expect(sectionTitle("/users")).toBe(copy.nav.users);
    expect(sectionTitle("/organization")).toBe(copy.nav.organization);
  });

  it("follows the fleet tab being shown", () => {
    expect(sectionTitle("/fleet", "suppliers")).toBe(copy.nav.suppliers);
    expect(sectionTitle("/fleet", "asset-types")).toBe(copy.nav.assetTypes);
    expect(sectionTitle("/fleet", "equipment")).toBe(copy.nav.fleet);
    expect(sectionTitle("/fleet", "unknown")).toBe(copy.nav.fleet);
    expect(sectionTitle("/fleet/equipment/abc", "suppliers")).toBe(copy.nav.fleet);
  });

  it("falls back to the product name for unknown paths", () => {
    expect(sectionTitle("/nowhere")).toBe(copy.common.productName);
  });
});

describe("isCurrent", () => {
  it("matches home only exactly and other entries by segment", () => {
    expect(isCurrent("/", "/")).toBe(true);
    expect(isCurrent("/", "/fleet")).toBe(false);
    expect(isCurrent("/fleet", "/fleet/x")).toBe(true);
    expect(isCurrent("/fleet", "/fleetish")).toBe(false);
    expect(isCurrent("/fleet?tab=suppliers", "/fleet")).toBe(true);
  });
});

describe("fleetTabOf", () => {
  it("keeps the known tabs and falls back to equipment", () => {
    expect(fleetTabOf("suppliers")).toBe("suppliers");
    expect(fleetTabOf("asset-types")).toBe("asset-types");
    expect(fleetTabOf("equipment")).toBe("equipment");
    expect(fleetTabOf("nope")).toBe("equipment");
    expect(fleetTabOf(null)).toBe("equipment");
  });
});

describe("isActive", () => {
  const items = navigationFor(ALL).flatMap((section) => section.items);
  const item = (label: string): NavItem => {
    const found = items.find((candidate) => candidate.label === label);
    if (found === undefined) throw new Error(label);
    return found;
  };
  const activeAt = (pathname: string, tab: string | null) =>
    items.filter((candidate) => isActive(candidate, pathname, tab)).map((candidate) => candidate.label);

  it("marks only Flota on the equipment tab, with no tab or an unknown one", () => {
    expect(activeAt("/fleet", null)).toEqual([copy.nav.fleet]);
    expect(activeAt("/fleet", "equipment")).toEqual([copy.nav.fleet]);
    expect(activeAt("/fleet", "unknown")).toEqual([copy.nav.fleet]);
  });

  it("marks only Proveedores on the suppliers tab and only Tipos de equipo on theirs", () => {
    expect(activeAt("/fleet", "suppliers")).toEqual([copy.nav.suppliers]);
    expect(activeAt("/fleet", "asset-types")).toEqual([copy.nav.assetTypes]);
  });

  it("marks Flota on an equipment detail page whatever the query says", () => {
    expect(activeAt("/fleet/equipment/abc", null)).toEqual([copy.nav.fleet]);
    expect(activeAt("/fleet/equipment/abc", "suppliers")).toEqual([copy.nav.fleet]);
  });

  it("keeps working for entries that are not tabs", () => {
    expect(activeAt("/", null)).toEqual([copy.nav.home]);
    expect(activeAt("/users", "suppliers")).toEqual([copy.nav.users]);
    expect(isActive(item(copy.nav.organization), "/organization", null)).toBe(true);
    expect(isActive(item(copy.nav.suppliers), "/organization", "suppliers")).toBe(false);
  });
});

describe("initialsOf", () => {
  it("uses the first and last word, uppercased", () => {
    expect(initialsOf("juan carlos pérez")).toBe("JP");
    expect(initialsOf("Ana")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
  });
});
