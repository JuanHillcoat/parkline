import { describe, expect, it } from "vitest";
import { nameKey } from "../../../shared/domain/catalog-name";
import { imageHash } from "../../../shared/domain/image";
import { OperationArchivedError, ReasonRequiredError, InvalidDayError, InvalidAssignmentKindError } from "../../domain/errors";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const setup = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const input = (code: string, assignment?: object, overrides: object = {}) => ({
    ...h.equipmentInput(s.supplierA.id, s.forklift.id, code),
    assignment: assignment === undefined ? undefined : { operationId: "op1", kind: "active", day: "2026-01-01", reason: null, ...assignment },
    ...overrides,
  });
  return { h, s, input };
};

const nothingStored = async (h: Harness, code: string, supplierId: string) => {
  const found = await h.store.read((tx) => tx.equipment.findByInternalCode("t-a", supplierId, nameKey(code)));
  return found === null;
};

describe("CreateEquipment with an assignment", () => {
  it("creates the equipment already assigned from today and writes both audit entries", async () => {
    const { h, input } = await setup();
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-NEW", {})));
    const rows = await h.assignmentsOf(created.id);
    expect(rows).toMatchObject([{ operationId: "op1", businessUnitId: "bu1", siteId: "s1", kind: "active", validFrom: "2026-01-01", validTo: null, reason: null }]);
    expect(h.auditOf("fleet.equipment.create").filter((e) => e.entityId === created.id)).toHaveLength(1);
    expect(h.auditOf("fleet.assignment.create")).toMatchObject([{ subjectEquipmentId: created.id, operationId: "op1", actorRole: "admin" }]);
    const order = h.audit.entries.map((e) => e.action);
    expect(order.lastIndexOf("fleet.equipment.create")).toBeLessThan(order.indexOf("fleet.assignment.create"));
  });

  it("creates a spare assignment", async () => {
    const { h, input } = await setup();
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-SPARE", { kind: "spare" })));
    expect((await h.assignmentsOf(created.id))[0]?.kind).toBe("spare");
  });

  it("stores the reason of a past day in the row and the audit entry", async () => {
    const { h, input } = await setup();
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-PAST", { day: "2025-12-01", reason: "Cargado tarde" })));
    expect((await h.assignmentsOf(created.id))[0]).toMatchObject({ validFrom: "2025-12-01", reason: "Cargado tarde" });
    expect(h.auditOf("fleet.assignment.create").at(-1)).toMatchObject({ reason: "Cargado tarde" });
  });

  it("creates the equipment, its image and the assignment together", async () => {
    const { h, input } = await setup();
    const jpeg = new Uint8Array(32).fill(7);
    jpeg.set([0xff, 0xd8, 0xff]);
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-IMG", {}, { image: jpeg })));
    expect(await h.assignmentsOf(created.id)).toHaveLength(1);
    expect(h.orThrow(await h.getEquipmentImage.execute({ actor: h.admin, id: created.id })).sha256).toBe(imageHash(jpeg));
  });

  it("stores no image and no assignment when the assignment is refused", async () => {
    const { h, s, input } = await setup();
    const jpeg = new Uint8Array(32).fill(7);
    jpeg.set([0xff, 0xd8, 0xff]);
    const result = await h.createEquipment.execute(input("EQ-IMGF", { operationId: "opx" }, { image: jpeg }));
    expect(result.ok).toBe(false);
    expect(await nothingStored(h, "EQ-IMGF", s.supplierA.id)).toBe(true);
  });

  it("stores nothing when the image is refused although the assignment alone would succeed", async () => {
    const { h, s, input } = await setup();
    const text = new TextEncoder().encode("this is not an image");
    const result = await h.createEquipment.execute(input("EQ-BADIMG", {}, { image: text }));
    expect(result.ok).toBe(false);
    expect(await nothingStored(h, "EQ-BADIMG", s.supplierA.id)).toBe(true);
    expect(h.auditOf("fleet.assignment.create")).toHaveLength(0);
  });

  describe.each([
    ["a past day without a reason", { day: "2025-12-31" }, ReasonRequiredError],
    ["a past day with a blank reason", { day: "2025-12-31", reason: "  " }, ReasonRequiredError],
    ["an archived operation", { operationId: "opx" }, OperationArchivedError],
    ["an invalid day", { day: "10/01/2026" }, InvalidDayError],
    ["an invalid kind", { kind: "loan" }, InvalidAssignmentKindError],
  ])("%s", (_name, assignment, errorClass) => {
    it("returns the typed error and stores nothing", async () => {
      const { h, s, input } = await setup();
      const equipmentAudits = h.auditOf("fleet.equipment.create").length;
      const result = await h.createEquipment.execute(input("EQ-FAIL", assignment));
      expect(!result.ok && result.error).toBeInstanceOf(errorClass);
      expect(await nothingStored(h, "EQ-FAIL", s.supplierA.id)).toBe(true);
      expect(h.auditOf("fleet.equipment.create")).toHaveLength(equipmentAudits);
      expect(h.auditOf("fleet.assignment.create")).toHaveLength(0);
    });
  });

  it("answers not found to a tenant-wide writer for an unknown operation and stores nothing", async () => {
    const { h, s, input } = await setup();
    const result = await h.createEquipment.execute(input("EQ-UNK", { operationId: "missing" }));
    expect(!result.ok && result.error.code).toBe("not_found");
    expect(await nothingStored(h, "EQ-UNK", s.supplierA.id)).toBe(true);
  });

  it("does not see an operation of another tenant", async () => {
    const { h, s, input } = await setup();
    const result = await h.createEquipment.execute(input("EQ-FOR", { operationId: "opb" }));
    expect(!result.ok && result.error.code).toBe("not_found");
    expect(await nothingStored(h, "EQ-FOR", s.supplierA.id)).toBe(true);
  });

  it("refuses an actor scoped to another operation, with nothing stored", async () => {
    const { h, s, input } = await setup();
    const elsewhere = h.analystAt("op2");
    const result = await h.createEquipment.execute({ ...input("EQ-DENY", { operationId: "op1" }), actor: elsewhere });
    expect(!result.ok && result.error.code).toBe("forbidden");
    expect(await nothingStored(h, "EQ-DENY", s.supplierA.id)).toBe(true);
  });

  it("answers forbidden for any operation id before invalid input or lookups can answer", async () => {
    const { h, input } = await setup();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    for (const operationId of ["missing", "op1", "opx", "opb"]) {
      const result = await h.createEquipment.execute({ ...input("EQ-V", { operationId, day: "nope", kind: "loan" }), actor: viewer });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
  });

  it("keeps the duplicate-code error and stores nothing of the assignment", async () => {
    const { h, s, input } = await setup();
    const result = await h.createEquipment.execute(input("eq-0001", {}));
    expect(!result.ok && result.error.code).toBe("internal_code_taken");
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(0);
    expect(h.auditOf("fleet.assignment.create")).toHaveLength(0);
  });

  it("behaves exactly as before without an assignment", async () => {
    const { h, input } = await setup();
    const created = h.orThrow(await h.createEquipment.execute(input("EQ-PLAIN")));
    expect(await h.assignmentsOf(created.id)).toHaveLength(0);
    expect(h.auditOf("fleet.assignment.create")).toHaveLength(0);
  });
});
