import { describe, expect, it } from "vitest";
import { assignFields, correctFields, endFields, moveFields, replaceFields } from "../assignment-form";

const form = (values: Record<string, string>): FormData => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe("assignFields", () => {
  it("reads the equipment, operation, kind and day; a blank reason is not set", () => {
    const fields = assignFields(form({ equipmentId: "e1", operationId: "o1", kind: "spare", day: "2026-01-05", reason: "  " }));
    expect(fields).toEqual({ equipmentId: "e1", operationId: "o1", kind: "spare", day: "2026-01-05", reason: null });
  });

  it("keeps a reason as typed and reads missing fields as blank text for the use case to refuse", () => {
    expect(assignFields(form({ reason: "Loaded late" })).reason).toBe("Loaded late");
    expect(assignFields(form({}))).toMatchObject({ equipmentId: "", operationId: "", kind: "", day: "" });
  });

  it("trims the day, which is always text and never a Date", () => {
    expect(assignFields(form({ day: " 2026-01-05 " })).day).toBe("2026-01-05");
  });
});

describe("moveFields", () => {
  it("reads the equipment, the target operation, the day and the reason", () => {
    expect(moveFields(form({ equipmentId: "e1", operationId: "o2", day: "2026-02-01", reason: "Contract" }))).toEqual({
      equipmentId: "e1", operationId: "o2", day: "2026-02-01", reason: "Contract",
    });
  });
});

describe("replaceFields", () => {
  const base = { equipmentId: "out", incomingEquipmentId: "in", day: "2026-03-01", reason: "New unit" };

  it("sends the choice of the form as it is: spare or retire", () => {
    expect(replaceFields(form({ ...base, outgoing: "spare" }))).toEqual({
      outgoingEquipmentId: "out", incomingEquipmentId: "in", day: "2026-03-01", reason: "New unit", outgoing: "spare",
    });
    expect(replaceFields(form({ ...base, outgoing: "retire" })).outgoing).toBe("retire");
  });

  it("never defaults a missing or unknown choice to either path: the use case then asks for it", () => {
    expect(replaceFields(form(base)).outgoing).toBeUndefined();
    expect(replaceFields(form({ ...base, outgoing: "" })).outgoing).toBeUndefined();
    expect(replaceFields(form({ ...base, outgoing: "delete" })).outgoing).toBeUndefined();
  });
});

describe("endFields", () => {
  it("reads the equipment, the last day and the reason", () => {
    expect(endFields(form({ equipmentId: "e1", day: "2026-01-31", reason: "Parked" }))).toEqual({
      equipmentId: "e1", day: "2026-01-31", reason: "Parked",
    });
  });
});

describe("correctFields", () => {
  const base = { assignmentId: "a1", validFrom: "2026-01-01", validTo: "2026-02-15", operationId: "o1", kind: "spare", reason: "Typo" };

  it("sends every field of the correction", () => {
    expect(correctFields(form(base))).toEqual({
      assignmentId: "a1", validFrom: "2026-01-01", validTo: "2026-02-15", operationId: "o1", kind: "spare", reason: "Typo",
    });
  });

  it("reads an empty end as null, which makes the assignment open again", () => {
    expect(correctFields(form({ ...base, validTo: "" })).validTo).toBeNull();
    expect(correctFields(form({ ...base, validTo: "  " })).validTo).toBeNull();
  });
});
