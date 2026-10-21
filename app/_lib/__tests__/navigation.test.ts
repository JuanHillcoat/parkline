import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { initialsOf, isCurrent, navigationFor, sectionTitle } from "../navigation";

const NONE = { fleet: false, users: false, organization: false };
const ALL = { fleet: true, users: true, organization: true };

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

  it("never lists entries for functions that do not exist yet", () => {
    expect(hrefs(ALL)).toEqual(["/", "/fleet", "/users", "/organization"]);
  });
});

describe("sectionTitle", () => {
  it("maps known paths and their children to the section label", () => {
    expect(sectionTitle("/")).toBe(copy.nav.home);
    expect(sectionTitle("/fleet")).toBe(copy.nav.fleet);
    expect(sectionTitle("/fleet/abc")).toBe(copy.nav.fleet);
    expect(sectionTitle("/users")).toBe(copy.nav.users);
    expect(sectionTitle("/organization")).toBe(copy.nav.organization);
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
  });
});

describe("initialsOf", () => {
  it("uses the first and last word, uppercased", () => {
    expect(initialsOf("juan carlos pérez")).toBe("JP");
    expect(initialsOf("Ana")).toBe("A");
    expect(initialsOf("  ")).toBe("?");
  });
});
