import { describe, expect, it } from "vitest";
import { correctReadingFields, initialReadingOnCreate, readingNumber, recordFields, replaceMeterFields } from "../readings-form";

const form = (entries: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
};

describe("readingNumber", () => {
  it("parses digits with an optional decimal part, with a dot or a comma", () => {
    expect(readingNumber("1234")).toBe(1234);
    expect(readingNumber(" 1234.5 ")).toBe(1234.5);
    expect(readingNumber("1234,5")).toBe(1234.5);
    expect(readingNumber("0")).toBe(0);
  });

  it("keeps a second decimal so the use case refuses it with its typed error", () => {
    expect(readingNumber("1.25")).toBe(1.25);
  });

  it("returns NaN for an empty, negative or non numeric text", () => {
    for (const raw of ["", "  ", "abc", "-1", "1e3", "1,5,2", "1.", ".5", "0x10"]) expect(readingNumber(raw)).toBeNaN();
  });
});

describe("recordFields", () => {
  it("maps the day, the value and a blank reason to null", () => {
    expect(recordFields(form({ equipmentId: "e1", day: " 2026-01-05 ", value: "10,5", reason: "  " }))).toEqual({
      equipmentId: "e1", day: "2026-01-05", value: 10.5, reason: null,
    });
  });

  it("keeps a typed reason", () => {
    expect(recordFields(form({ equipmentId: "e1", day: "2026-01-05", value: "1", reason: "Late" })).reason).toBe("Late");
  });
});

describe("correctReadingFields and replaceMeterFields", () => {
  it("map the correction", () => {
    expect(correctReadingFields(form({ equipmentId: "e1", readingId: "r1", value: "12", reason: "Typo" }))).toEqual({
      equipmentId: "e1", readingId: "r1", value: 12, reason: "Typo",
    });
  });

  it("map the replacement and send a missing value as NaN", () => {
    const fields = replaceMeterFields(form({ equipmentId: "e1", day: "2026-02-01", finalValue: "500", initialValue: "", reason: "Broken" }));
    expect(fields).toMatchObject({ equipmentId: "e1", day: "2026-02-01", finalValue: 500, reason: "Broken" });
    expect(fields.initialValue).toBeNaN();
  });
});

describe("initialReadingOnCreate", () => {
  it("sends nothing unless a value was typed", () => {
    expect(initialReadingOnCreate(form({}))).toBeUndefined();
    expect(initialReadingOnCreate(form({ readingValue: "  ", day: "2026-01-05" }))).toBeUndefined();
  });

  it("sends the value with the day of the registration (Fecha de ingreso), shared with the assignment", () => {
    expect(initialReadingOnCreate(form({ readingValue: "120,5", day: " 2026-01-05 " }))).toEqual({ day: "2026-01-05", value: 120.5 });
  });

  it("does not read a separate reading day: the registration has none", () => {
    expect(initialReadingOnCreate(form({ readingValue: "7", day: "2026-01-05", readingDay: "2025-01-01" }))?.day).toBe("2026-01-05");
  });

  it("sends an empty day with a typed value, so the server answers with its typed day error", () => {
    expect(initialReadingOnCreate(form({ readingValue: "5", day: "" }))).toEqual({ day: "", value: 5 });
  });

  it("sends a value that is not a number as NaN", () => {
    expect(initialReadingOnCreate(form({ readingValue: "abc", day: "2026-01-05" }))?.value).toBeNaN();
  });
});
