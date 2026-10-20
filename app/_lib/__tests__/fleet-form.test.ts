import { describe, expect, it } from "vitest";
import { assetTypeFields, equipmentFields, optionalInteger, optionalText } from "../fleet-form";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("optionalInteger", () => {
  it("turns a blank string into null", () => {
    expect(optionalInteger("")).toBeNull();
    expect(optionalInteger("   ")).toBeNull();
  });

  it("parses whole numbers, including zero and surrounding spaces", () => {
    expect(optionalInteger("2020")).toBe(2020);
    expect(optionalInteger(" 0 ")).toBe(0);
  });

  it("returns NaN for anything else so the domain rejects it with its typed error", () => {
    for (const raw of ["abc", "1.5", "12abc", "1e3", "0x10", "--1"]) expect(optionalInteger(raw)).toBeNaN();
  });
});

describe("optionalText", () => {
  it("turns blank text into null and keeps the rest", () => {
    expect(optionalText("  ")).toBeNull();
    expect(optionalText("BRAND X")).toBe("BRAND X");
  });
});

describe("assetTypeFields", () => {
  it("reads the name, the meter kind and the interval as a number", () => {
    const data = form({ name: "forklift", meterKind: "hours", preventiveIntervalHours: "250" });
    expect(assetTypeFields(data)).toEqual({ name: "forklift", meterKind: "hours", preventiveIntervalHours: 250 });
  });

  it("gives a null interval when the field is missing, as when it is disabled", () => {
    expect(assetTypeFields(form({ name: "x", meterKind: "none" })).preventiveIntervalHours).toBeNull();
  });
});

describe("equipmentFields", () => {
  it("converts numbers and blank optional text", () => {
    const data = form({
      supplierId: "s1", assetTypeId: "a1", internalCode: "c-043", brand: "", model: "M-1",
      year: "2020", serialNumber: " ", batteryQuantity: "2", observations: "",
    });
    expect(equipmentFields(data)).toEqual({
      supplierId: "s1", assetTypeId: "a1", internalCode: "c-043", brand: null, model: "M-1",
      year: 2020, serialNumber: null, batteryQuantity: 2, observations: null,
    });
  });

  it("keeps an invalid year as NaN instead of hiding it", () => {
    expect(equipmentFields(form({ year: "abc" })).year).toBeNaN();
  });
});
