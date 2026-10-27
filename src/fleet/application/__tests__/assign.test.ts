import { describe, expect, it } from "vitest";
import {
  ArchivedError,
  AssignmentOverlapError,
  InvalidDayError,
  OpenAssignmentError,
  OperationArchivedError,
  ReasonRequiredError,
  ReasonTooLongError,
} from "../../domain/errors";
import { MAX_REASON_LENGTH } from "../reason";
import { actorWith, createHarness, grant, START } from "./support/harness";

const base = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  return { h, s, input: { actor: h.admin, equipmentId: s.eq1.id, target: { operationId: "op1" }, day: "2026-01-10" } };
};

describe("AssignEquipment", () => {
  it("creates an open assignment, copies the division and site of the operation and audits it", async () => {
    const { h, s, input } = await base();
    const result = await h.assignEquipment.execute(input);
    expect(result.ok && result.value).toMatchObject({
      equipmentId: s.eq1.id, tenantId: "t-a", operationId: "op1", businessUnitId: "bu1", siteId: "s1",
      kind: "active", validFrom: "2026-01-10", validTo: null, reason: null, createdBy: "user-1", createdAt: START,
    });
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
    expect(h.auditOf("fleet.assignment.create")).toMatchObject([
      {
        entityType: "equipment_assignment", subjectEquipmentId: s.eq1.id, actorRole: "admin",
        businessUnitId: "bu1", operationId: "op1", siteId: "s1",
        after: { operationId: "op1", kind: "active", validFrom: "2026-01-10", validTo: null },
      },
    ]);
  });

  it("derives the kind from the target: an operation is active, a site is a spare without operation", async () => {
    const { h, input } = await base();
    const result = await h.assignEquipment.execute({ ...input, target: { siteId: "s1" } });
    expect(result.ok && result.value).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: "s1" });
  });

  it("needs no reason for today or a future day, and keeps one when it is given", async () => {
    const { h, s, input } = await base();
    expect((await h.assignEquipment.execute({ ...input, day: "2026-01-01" })).ok).toBe(true);
    const other = await h.assignEquipment.execute({ ...input, equipmentId: s.c43.id, reason: "  Pedido  " });
    expect(other.ok && other.value.reason).toBe("Pedido");
    expect(h.auditOf("fleet.assignment.create").at(-1)?.reason).toBe("Pedido");
  });

  it("requires a reason for a past day and stores it in the row and the audit entry", async () => {
    const { h, s, input } = await base();
    const without = await h.assignEquipment.execute({ ...input, day: "2025-12-31" });
    const blank = await h.assignEquipment.execute({ ...input, day: "2025-12-31", reason: "  " });
    expect(!without.ok && without.error).toBeInstanceOf(ReasonRequiredError);
    expect(!blank.ok && blank.error).toBeInstanceOf(ReasonRequiredError);
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(0);
    const done = await h.assignEquipment.execute({ ...input, day: "2025-12-31", reason: "Cargado tarde" });
    expect(done.ok && done.value.reason).toBe("Cargado tarde");
    expect(h.auditOf("fleet.assignment.create").at(-1)).toMatchObject({ reason: "Cargado tarde" });
  });

  it("rejects a reason over the maximum length", async () => {
    const { h, input } = await base();
    const result = await h.assignEquipment.execute({ ...input, reason: "x".repeat(MAX_REASON_LENGTH + 1) });
    expect(!result.ok && result.error).toBeInstanceOf(ReasonTooLongError);
  });

  it("uses the injected clock to decide what is the past", async () => {
    const { h, input } = await base();
    h.clock.set(new Date("2026-03-01T00:00:00Z"));
    const result = await h.assignEquipment.execute({ ...input, day: "2026-02-28" });
    expect(!result.ok && result.error).toBeInstanceOf(ReasonRequiredError);
  });

  it("returns a typed validation error for a bad day, never throws", async () => {
    const { h, input } = await base();
    const day = await h.assignEquipment.execute({ ...input, day: "10/01/2026" });
    expect(!day.ok && day.error).toBeInstanceOf(InvalidDayError);
  });

  it("refuses a second open assignment of the same equipment", async () => {
    const { h, s, input } = await base();
    await h.assignEquipment.execute(input);
    const again = await h.assignEquipment.execute({ ...input, target: { operationId: "op2" }, day: "2026-02-01" });
    expect(!again.ok && again.error).toBeInstanceOf(OpenAssignmentError);
    expect(!again.ok && again.error.code).toBe("open_assignment_exists");
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
  });

  it("allows a contiguous assignment after a closed one and refuses an overlapping one", async () => {
    const { h, s, input } = await base();
    await h.assignEquipment.execute(input);
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    const contiguous = await h.assignEquipment.execute({ ...input, target: { operationId: "op2" }, day: "2026-02-01" });
    expect(contiguous.ok).toBe(true);
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-28", reason: "Fin" });
    const overlapping = await h.assignEquipment.execute({ ...input, day: "2026-02-28" });
    expect(!overlapping.ok && overlapping.error).toBeInstanceOf(AssignmentOverlapError);
    const before = await h.assignEquipment.execute({ ...input, day: "2026-01-05" });
    expect(!before.ok && before.error).toBeInstanceOf(AssignmentOverlapError);
  });

  it("refuses an open assignment that would run over a later one already recorded", async () => {
    const { h, s, input } = await base();
    await h.assignEquipment.execute({ ...input, day: "2026-06-01" });
    const early = await h.assignEquipment.execute({ ...input, day: "2026-05-01" });
    expect(!early.ok && early.error.code).toBe("open_assignment_exists");
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
  });

  it("refuses an open assignment that would run over a later closed one", async () => {
    const { h, s, input } = await base();
    await h.assignEquipment.execute({ ...input, day: "2026-06-01" });
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-06-30", reason: "Fin" });
    const early = await h.assignEquipment.execute({ ...input, day: "2026-05-01" });
    expect(!early.ok && early.error.code).toBe("assignment_overlap");
  });

  it("refuses an archived equipment", async () => {
    const { h, s, input } = await base();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    const result = await h.assignEquipment.execute(input);
    expect(!result.ok && result.error).toBeInstanceOf(ArchivedError);
  });

  it("refuses an archived operation", async () => {
    const { h, input } = await base();
    const result = await h.assignEquipment.execute({ ...input, target: { operationId: "opx" } });
    expect(!result.ok && result.error).toBeInstanceOf(OperationArchivedError);
    expect(!result.ok && result.error.code).toBe("operation_archived");
  });

  it("answers not found for a missing equipment or operation to a tenant-wide writer", async () => {
    const { h, input } = await base();
    const equipment = await h.assignEquipment.execute({ ...input, equipmentId: "missing" });
    const operation = await h.assignEquipment.execute({ ...input, target: { operationId: "missing" } });
    expect(!equipment.ok && equipment.error.code).toBe("not_found");
    expect(!operation.ok && operation.error.code).toBe("not_found");
  });

  it("does not see equipment or operations of another tenant", async () => {
    const { h, s, input } = await base();
    const foreignEquipment = await h.assignEquipment.execute({ ...input, actor: h.adminB, target: { operationId: "opb" } });
    const foreignOperation = await h.assignEquipment.execute({ ...input, equipmentId: s.eq1.id, target: { operationId: "opb" } });
    expect(!foreignEquipment.ok && foreignEquipment.error.code).toBe("not_found");
    expect(!foreignOperation.ok && foreignOperation.error.code).toBe("not_found");
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(0);
  });

  it("is limited to the operations the actor may write", async () => {
    const { h, input } = await base();
    const outside = await h.assignEquipment.execute({ ...input, actor: h.analystAt("op2") });
    const inside = await h.assignEquipment.execute({ ...input, actor: h.analystAt("op1") });
    expect(!outside.ok && outside.error.code).toBe("forbidden");
    expect(inside.ok).toBe(true);
  });

  it("refuses roles that cannot write and an inactive actor", async () => {
    const { h, input } = await base();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    const inactive = actorWith([grant("admin", "tenant", "t-a")], { active: false });
    for (const actor of [viewer, inactive]) {
      const result = await h.assignEquipment.execute({ ...input, actor });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    expect(h.auditOf("fleet.assignment.create")).toHaveLength(0);
  });
});
