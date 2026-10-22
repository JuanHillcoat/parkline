import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

const setup = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
  const input = { actor: h.admin, equipmentId: s.eq1.id, operationId: "op2", day: "2026-02-01", reason: "Pedido de la operación" };
  return { h, s, first, input };
};

describe("MoveEquipment", () => {
  it("closes the open assignment the day before and opens the new one on the day, in one step", async () => {
    const { h, s, first, input } = await setup();
    const result = await h.moveEquipment.execute(input);
    expect(result.ok && result.value.closed).toMatchObject({ id: first.id, operationId: "op1", validTo: "2026-01-31" });
    expect(result.ok && result.value.opened).toMatchObject({
      operationId: "op2", businessUnitId: "bu1", siteId: "s2", kind: "active", validFrom: "2026-02-01", validTo: null,
      reason: "Pedido de la operación",
    });
    const rows = await h.assignmentsOf(s.eq1.id);
    expect(rows.map((r) => [r.operationId, r.validFrom, r.validTo])).toEqual([
      ["op2", "2026-02-01", null],
      ["op1", "2026-01-10", "2026-01-31"],
    ]);
  });

  it("audits one sensitive entry with the reason, the source and the target", async () => {
    const { h, s, first, input } = await setup();
    await h.moveEquipment.execute(input);
    expect(h.auditOf("fleet.assignment.move")).toMatchObject([
      {
        entityType: "equipment_assignment", subjectEquipmentId: s.eq1.id, reason: "Pedido de la operación",
        operationId: "op2", businessUnitId: "bu1", siteId: "s2",
        before: { id: first.id, operationId: "op1", validTo: null },
        after: { operationId: "op2", validFrom: "2026-02-01", validTo: null },
      },
    ]);
  });

  it("keeps the kind of the closed assignment unless another is given", async () => {
    const { h, s, input } = await setup();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-20", reason: "Fin" });
    await h.assign(s.eq1.id, "op1", "2026-01-21", { kind: "spare" });
    const kept = await h.moveEquipment.execute(input);
    expect(kept.ok && kept.value.opened.kind).toBe("spare");
    const changed = await h.moveEquipment.execute({ ...input, operationId: "op3", day: "2026-03-01", kind: "active" });
    expect(changed.ok && changed.value.opened.kind).toBe("active");
  });

  it("requires a reason, even for a future day", async () => {
    const { h, s, input } = await setup();
    for (const reason of ["", "   "]) {
      const result = await h.moveEquipment.execute({ ...input, reason });
      expect(!result.ok && result.error.code).toBe("reason_required");
    }
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => r.validTo)).toEqual([null]);
    expect(h.auditOf("fleet.assignment.move")).toHaveLength(0);
  });

  it("accepts a past day with a reason", async () => {
    const { h, input } = await setup();
    const result = await h.moveEquipment.execute({ ...input, day: "2026-01-11" });
    expect(result.ok && result.value.closed.validTo).toBe("2026-01-10");
  });

  it("refuses a day that leaves the closed assignment empty (not after its start)", async () => {
    const { h, s, input } = await setup();
    for (const day of ["2026-01-10", "2026-01-05"]) {
      const result = await h.moveEquipment.execute({ ...input, day });
      expect(!result.ok && result.error.code).toBe("invalid_period");
    }
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
  });

  it("refuses an invalid day, an unknown kind and a move to the same operation", async () => {
    const { h, input } = await setup();
    const day = await h.moveEquipment.execute({ ...input, day: "tomorrow" });
    const kind = await h.moveEquipment.execute({ ...input, kind: "loan" });
    const same = await h.moveEquipment.execute({ ...input, operationId: "op1" });
    expect(!day.ok && day.error.code).toBe("invalid_day");
    expect(!kind.ok && kind.error.code).toBe("invalid_assignment_kind");
    expect(!same.ok && same.error.code).toBe("same_operation");
  });

  it("refuses an equipment with no open assignment", async () => {
    const { h, s, input } = await setup();
    const result = await h.moveEquipment.execute({ ...input, equipmentId: s.c43.id });
    expect(!result.ok && result.error.code).toBe("no_open_assignment");
  });

  it("refuses an archived target operation and a missing one, changing nothing", async () => {
    const { h, s, input } = await setup();
    const archived = await h.moveEquipment.execute({ ...input, operationId: "opx" });
    const missing = await h.moveEquipment.execute({ ...input, operationId: "missing" });
    expect(!archived.ok && archived.error.code).toBe("operation_archived");
    expect(!missing.ok && missing.error.code).toBe("not_found");
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => r.validTo)).toEqual([null]);
  });

  it("needs catalog.write at the target AND at the source operation", async () => {
    const { h, s, input } = await setup();
    const sourceOnly = await h.moveEquipment.execute({ ...input, actor: h.analystAt("op1") });
    const targetOnly = await h.moveEquipment.execute({ ...input, actor: h.analystAt("op2") });
    expect(!sourceOnly.ok && sourceOnly.error.code).toBe("forbidden");
    expect(!targetOnly.ok && targetOnly.error.code).toBe("forbidden");
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => r.validTo)).toEqual([null]);
    const both = actorBoth(h);
    expect((await h.moveEquipment.execute({ ...input, actor: both })).ok).toBe(true);
  });

  it("does not move the equipment of another tenant", async () => {
    const { h, s, input } = await setup();
    const result = await h.moveEquipment.execute({ ...input, actor: h.adminB, operationId: "opb" });
    expect(!result.ok && result.error.code).toBe("no_open_assignment");
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => r.validTo)).toEqual([null]);
  });

  it("leaves nothing behind when the audit write fails", async () => {
    const { h, s, input } = await setup();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.moveEquipment.execute(input)).rejects.toThrow("audit down");
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => r.validTo)).toEqual([null]);
  });
});

const actorBoth = (h: Awaited<ReturnType<typeof setup>>["h"]) => ({
  ...h.admin,
  grants: [
    { role: "admin", scopeType: "operation", scopeId: "op1" },
    { role: "admin", scopeType: "operation", scopeId: "op2" },
  ],
});
