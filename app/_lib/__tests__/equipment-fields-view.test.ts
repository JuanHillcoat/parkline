import { describe, expect, it } from "vitest";
import { BATTERY_KINDS } from "../../../src/fleet/domain/values";
import {
  batteryKindOptions,
  isMuleto,
  MULETO,
  NO_PLACEMENT,
  offersMuleto,
  operationOfChoice,
  placementChoice,
  readingFieldLabel,
  showsBatteryQuantity,
} from "../equipment-fields-view";
import { siteOptions } from "../fleet-view";

describe("batteryKindOptions", () => {
  it("lists Litio, Plomo ácido and Combustión, in the order of the domain", () => {
    expect(batteryKindOptions()).toEqual([
      { id: "lithium", name: "Litio" },
      { id: "lead_acid", name: "Plomo ácido" },
      { id: "combustion", name: "Combustión" },
    ]);
    expect(batteryKindOptions().map((option) => option.id)).toEqual([...BATTERY_KINDS]);
  });
});

describe("showsBatteryQuantity", () => {
  it("is true only for lead acid: not for lithium, combustion or nothing chosen", () => {
    expect(showsBatteryQuantity("lead_acid")).toBe(true);
    for (const kind of ["lithium", "combustion", "", "other"]) expect(showsBatteryQuantity(kind)).toBe(false);
  });
});

describe("readingFieldLabel", () => {
  it("is Horómetro for hours, Kilometraje for km, and nothing for a type without a meter", () => {
    expect(readingFieldLabel("hours")).toBe("Horómetro");
    expect(readingFieldLabel("km")).toBe("Kilometraje");
    expect(readingFieldLabel("none")).toBeNull();
  });
});

describe("placement choice", () => {
  it("shows Muleto for a site and the operation otherwise, blank when nothing is chosen", () => {
    expect(placementChoice({ operationId: "", siteId: "si1" })).toBe(MULETO);
    expect(placementChoice({ operationId: "o1", siteId: "" })).toBe("o1");
    expect(placementChoice(NO_PLACEMENT)).toBe("");
  });

  it("never sends the Muleto marker as an operation id", () => {
    expect(operationOfChoice(MULETO)).toBe("");
    expect(operationOfChoice("o1")).toBe("o1");
    expect(operationOfChoice("")).toBe("");
  });

  it("recognizes Muleto only by its own marker", () => {
    expect(isMuleto(MULETO)).toBe(true);
    expect(isMuleto("o1")).toBe(false);
    expect(isMuleto("")).toBe(false);
  });

  it("offers Muleto only when there is a site to hold the spare", () => {
    expect(offersMuleto([{ id: "si1", name: "SITE ONE" }])).toBe(true);
    expect(offersMuleto([])).toBe(false);
  });
});

describe("siteOptions", () => {
  it("offers only the sites that are not archived", () => {
    const rows = [
      { id: "si1", name: "SITE ONE", archivedAt: null },
      { id: "si2", name: "SITE TWO", archivedAt: new Date("2026-01-01T00:00:00Z") },
    ];
    expect(siteOptions(rows)).toEqual([{ id: "si1", name: "SITE ONE" }]);
  });
});
