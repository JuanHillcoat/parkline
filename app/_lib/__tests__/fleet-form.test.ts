import { describe, expect, it } from "vitest";
import { assetTypeFields, assignmentOnCreate, equipmentFields, imageChange, newImage, optionalInteger, optionalText } from "../fleet-form";

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
  it("converts numbers and blank optional text, and passes brand and model as typed", () => {
    const data = form({
      supplierId: "s1", assetTypeId: "a1", internalCode: "c-043", brand: " ", model: "M-1",
      year: "2020", serialNumber: " ", batteryQuantity: "2", observations: "",
    });
    expect(equipmentFields(data)).toEqual({
      supplierId: "s1", assetTypeId: "a1", internalCode: "c-043", brand: " ", model: "M-1",
      year: 2020, serialNumber: null, batteryQuantity: 2, observations: null,
    });
  });

  it("keeps an invalid year as NaN instead of hiding it", () => {
    expect(equipmentFields(form({ year: "abc" })).year).toBeNaN();
  });
});

describe("assignmentOnCreate", () => {
  it("sends nothing when no operation was chosen, whatever the other fields carry", () => {
    expect(assignmentOnCreate(form({ operationId: "", kind: "active", day: "2026-01-10", reason: "x" }))).toBeUndefined();
    expect(assignmentOnCreate(form({}))).toBeUndefined();
    expect(assignmentOnCreate(form({ operationId: "   ", kind: "active", day: "2026-01-10" }))).toBeUndefined();
  });

  it("maps the chosen operation with its kind, trimmed day and a blank reason as null", () => {
    expect(assignmentOnCreate(form({ operationId: "op1", kind: "spare", day: " 2026-01-10 ", reason: "  " }))).toEqual({
      operationId: "op1", kind: "spare", day: "2026-01-10", reason: null,
    });
  });

  it("keeps a given reason for the use case to trim and validate", () => {
    expect(assignmentOnCreate(form({ operationId: "op1", kind: "active", day: "2026-01-10", reason: "Cargado tarde" }))?.reason).toBe(
      "Cargado tarde",
    );
  });

  it("does not leak into the equipment fields", () => {
    expect(equipmentFields(form({ operationId: "op1", kind: "active", day: "2026-01-10" }))).not.toHaveProperty("operationId");
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const withFile = (entries: Record<string, string>, file?: File): FormData => {
  const data = form(entries);
  if (file !== undefined) data.set("image", file);
  return data;
};
const chosen = new File([PNG], "photo.png", { type: "image/png" });
const noFile = new File([], "undefined", { type: "application/octet-stream" });

describe("newImage", () => {
  it("reads the bytes of the chosen file", async () => {
    expect(await newImage(withFile({}, chosen))).toEqual(PNG);
  });

  it("treats an empty file input (an empty file the form does not mark as chosen) and a missing field as no image", async () => {
    expect(await newImage(withFile({}, noFile))).toBeNull();
    expect(await newImage(form({}))).toBeNull();
    expect(await newImage(form({ image: "text" }))).toBeNull();
  });

  it("keeps a chosen file with no content empty, so the domain answers image_empty", async () => {
    expect(await newImage(withFile({ imageChosen: "1" }, new File([], "empty.png")))).toEqual(new Uint8Array(0));
  });
});

describe("imageChange", () => {
  it("keeps the image by default, when the action is missing or unknown", async () => {
    expect(await imageChange(withFile({}, chosen))).toEqual({ action: "keep" });
    expect(await imageChange(withFile({ imageAction: "other" }, chosen))).toEqual({ action: "keep" });
  });

  it("keeps the image and ignores a file left in the input", async () => {
    expect(await imageChange(withFile({ imageAction: "keep" }, chosen))).toEqual({ action: "keep" });
  });

  it("removes the image", async () => {
    expect(await imageChange(form({ imageAction: "remove" }))).toEqual({ action: "remove" });
  });

  it("replaces the image with the bytes of the chosen file", async () => {
    expect(await imageChange(withFile({ imageAction: "replace" }, chosen))).toEqual({ action: "replace", bytes: PNG });
  });

  it("turns a replacement with no file into an empty one, which the domain rejects", async () => {
    const empty = { action: "replace", bytes: new Uint8Array(0) };
    expect(await imageChange(withFile({ imageAction: "replace" }, noFile))).toEqual(empty);
    expect(await imageChange(withFile({ imageAction: "replace", imageChosen: "1" }, noFile))).toEqual(empty);
    expect(await imageChange(form({ imageAction: "replace" }))).toEqual(empty);
  });
});
