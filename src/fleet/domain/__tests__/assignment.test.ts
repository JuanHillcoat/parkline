import { describe, expect, it } from "vitest";
import { createAssignment, parseAssignmentKind, type AssignmentInput } from "../assignment";
import { InvalidAssignmentKindError, InvalidDayError, InvalidPeriodError } from "../errors";

const input = (overrides: Partial<AssignmentInput> = {}): AssignmentInput => ({
  id: "a1",
  tenantId: "t-a",
  equipmentId: "e1",
  businessUnitId: "bu1",
  operationId: "op1",
  siteId: "s1",
  kind: "active",
  validFrom: "2026-01-10",
  validTo: null,
  reason: null,
  createdBy: "user-1",
  createdAt: new Date("2026-01-10T09:00:00Z"),
  ...overrides,
});

describe("parseAssignmentKind", () => {
  it.each(["active", "spare"])("accepts %s", (kind) => {
    const parsed = parseAssignmentKind(kind);
    expect(parsed.ok && parsed.value).toBe(kind);
  });

  it.each(["", "Active", "muleto", "retired"])("rejects %j", (kind) => {
    const parsed = parseAssignmentKind(kind);
    expect(!parsed.ok && parsed.error).toBeInstanceOf(InvalidAssignmentKindError);
    expect(!parsed.ok && parsed.error.code).toBe("invalid_assignment_kind");
  });
});

describe("createAssignment: where the assignment is", () => {
  const spare = { kind: "spare", businessUnitId: null, operationId: null };

  it("builds a spare at a site: no operation and no division", () => {
    const created = createAssignment(input(spare));
    expect(created.ok && created.value).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: "s1" });
  });

  it("keeps a spare inside an operation (rows from before) valid", () => {
    expect(createAssignment(input({ kind: "spare" })).ok).toBe(true);
  });

  it.each([
    { name: "an active assignment without operation", override: { operationId: null, businessUnitId: null } },
    { name: "an operation without division", override: { kind: "spare", businessUnitId: null } },
    { name: "a division without operation", override: { kind: "spare", operationId: null } },
  ])("rejects $name", ({ override }) => {
    const created = createAssignment(input(override));
    expect(!created.ok && created.error.code).toBe("invalid_assignment_target");
  });
});

describe("createAssignment", () => {
  it("builds an open assignment", () => {
    const created = createAssignment(input());
    expect(created.ok && created.value).toMatchObject({ validFrom: "2026-01-10", validTo: null, kind: "active", reason: null });
  });

  it("builds a closed assignment of a single day (from equals to)", () => {
    const created = createAssignment(input({ validTo: "2026-01-10" }));
    expect(created.ok && created.value.validTo).toBe("2026-01-10");
  });

  it("rejects an end before the start with a typed period error", () => {
    const created = createAssignment(input({ validTo: "2026-01-09" }));
    expect(!created.ok && created.error).toBeInstanceOf(InvalidPeriodError);
    expect(!created.ok && created.error.code).toBe("invalid_period");
  });

  it("rejects malformed days, naming the field", () => {
    const from = createAssignment(input({ validFrom: "10/01/2026" }));
    const to = createAssignment(input({ validTo: "2026-02-30" }));
    expect(!from.ok && from.error).toBeInstanceOf(InvalidDayError);
    expect(!from.ok && from.error.field).toBe("validFrom");
    expect(!to.ok && to.error.field).toBe("validTo");
  });

  it("rejects an unknown kind", () => {
    const created = createAssignment(input({ kind: "loan" }));
    expect(!created.ok && created.error.code).toBe("invalid_assignment_kind");
  });

  it("trims the reason and turns a blank one into null", () => {
    const withReason = createAssignment(input({ reason: "  Pedido de la operación  " }));
    const blank = createAssignment(input({ reason: "   " }));
    expect(withReason.ok && withReason.value.reason).toBe("Pedido de la operación");
    expect(blank.ok && blank.value.reason).toBeNull();
  });
});
