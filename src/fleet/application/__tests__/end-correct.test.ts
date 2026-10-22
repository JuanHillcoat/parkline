import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

const setup = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
  return { h, s, first };
};

describe("EndAssignment", () => {
  it("closes the open assignment on the given day, keeps the row and audits it with the reason", async () => {
    const { h, s, first } = await setup();
    const result = await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-03-31", reason: "Fin de contrato" });
    expect(result.ok && result.value).toMatchObject({ id: first.id, validFrom: "2026-01-10", validTo: "2026-03-31", reason: "Fin de contrato" });
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
    expect(h.auditOf("fleet.assignment.end")).toMatchObject([
      {
        subjectEquipmentId: s.eq1.id, reason: "Fin de contrato", operationId: "op1",
        before: { validTo: null }, after: { validTo: "2026-03-31" },
      },
    ]);
  });

  it("accepts the very day it started (a one-day assignment) and refuses an earlier day", async () => {
    const { h, s } = await setup();
    const early = await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-09", reason: "Error" });
    expect(!early.ok && early.error.code).toBe("invalid_period");
    const same = await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-10", reason: "Un día" });
    expect(same.ok && same.value.validTo).toBe("2026-01-10");
  });

  it("requires a reason and a valid day, and changes nothing otherwise", async () => {
    const { h, s } = await setup();
    const reason = await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-03-31", reason: " " });
    const day = await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "31/03", reason: "Fin" });
    expect(!reason.ok && reason.error.code).toBe("reason_required");
    expect(!day.ok && day.error.code).toBe("invalid_day");
    expect((await h.assignmentsOf(s.eq1.id))[0]?.validTo).toBeNull();
  });

  it("refuses an equipment with no open assignment, then lets it be assigned again", async () => {
    const { h, s } = await setup();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-03-31", reason: "Fin" });
    const again = await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-04-30", reason: "Fin" });
    expect(!again.ok && again.error.code).toBe("no_open_assignment");
    expect((await h.assign(s.eq1.id, "op2", "2026-04-01")).operationId).toBe("op2");
  });

  it("needs catalog.write at the operation of the open assignment", async () => {
    const { h, s } = await setup();
    const input = { equipmentId: s.eq1.id, day: "2026-03-31", reason: "Fin" };
    const elsewhere = await h.endAssignment.execute({ ...input, actor: h.analystAt("op2") });
    const foreign = await h.endAssignment.execute({ ...input, actor: h.adminB });
    expect(!elsewhere.ok && elsewhere.error.code).toBe("forbidden");
    expect(!foreign.ok && foreign.error.code).toBe("no_open_assignment");
    expect((await h.endAssignment.execute({ ...input, actor: h.analystAt("op1") })).ok).toBe(true);
  });
});

describe("CorrectAssignment", () => {
  it("changes the start, the end, the operation and the kind, auditing before and after with the reason", async () => {
    const { h, s, first } = await setup();
    const result = await h.correctAssignment.execute({
      actor: h.admin, assignmentId: first.id, reason: "Fecha mal cargada",
      validFrom: "2026-01-05", validTo: "2026-02-20", operationId: "op3", kind: "spare",
    });
    expect(result.ok && result.value).toMatchObject({
      id: first.id, operationId: "op3", businessUnitId: "bu2", siteId: "s3", kind: "spare",
      validFrom: "2026-01-05", validTo: "2026-02-20", reason: "Fecha mal cargada",
    });
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
    expect(h.auditOf("fleet.assignment.correct")).toMatchObject([
      {
        reason: "Fecha mal cargada", subjectEquipmentId: s.eq1.id, operationId: "op3",
        before: { operationId: "op1", kind: "active", validFrom: "2026-01-10", validTo: null },
        after: { operationId: "op3", kind: "spare", validFrom: "2026-01-05", validTo: "2026-02-20" },
      },
    ]);
  });

  it("still corrects the dates of a closed assignment whose operation was archived later, but will not reopen it there", async () => {
    const { h, s, first } = await setup();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    h.operations.archive("op1", new Date("2026-03-01T00:00:00Z"));
    const dates = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Fecha", validTo: "2026-02-02" });
    expect(dates.ok && dates.value.validTo).toBe("2026-02-02");
    const reopened = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Sigue", validTo: null });
    expect(!reopened.ok && reopened.error.code).toBe("operation_archived");
    expect((await h.assignmentsOf(s.eq1.id))[0]?.validTo).toBe("2026-02-02");
  });

  it("keeps the fields it is not given, and can reopen an assignment with validTo null", async () => {
    const { h, s, first } = await setup();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    const kept = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Cambia el inicio", validFrom: "2026-01-12" });
    expect(kept.ok && kept.value).toMatchObject({ validFrom: "2026-01-12", validTo: "2026-02-01", operationId: "op1" });
    const reopened = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Sigue activo", validTo: null });
    expect(reopened.ok && reopened.value.validTo).toBeNull();
    expect((await h.assignmentsOf(s.eq1.id))[0]?.validTo).toBeNull();
  });

  it("requires a reason and refuses a correction that changes nothing", async () => {
    const { h, first } = await setup();
    const reason = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "", validFrom: "2026-01-05" });
    const none = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Nada", validFrom: "2026-01-10" });
    expect(!reason.ok && reason.error.code).toBe("reason_required");
    expect(!none.ok && none.error.code).toBe("no_changes");
    expect(h.auditOf("fleet.assignment.correct")).toHaveLength(0);
  });

  it("refuses an end before the start, a bad day and an unknown kind", async () => {
    const { h, first } = await setup();
    const period = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "x", validTo: "2026-01-09" });
    const day = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "x", validFrom: "2026-02-30" });
    const kind = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "x", kind: "loan" });
    expect(!period.ok && period.error.code).toBe("invalid_period");
    expect(!day.ok && day.error.code).toBe("invalid_day");
    expect(!kind.ok && kind.error.code).toBe("invalid_assignment_kind");
  });

  it("keeps the no-overlap rule against the other assignments of the equipment", async () => {
    const { h, s, first } = await setup();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    const second = await h.assign(s.eq1.id, "op2", "2026-02-01");
    const into = await h.correctAssignment.execute({ actor: h.admin, assignmentId: second.id, reason: "Adelanta", validFrom: "2026-01-31" });
    const over = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Alarga", validTo: "2026-02-01" });
    const contained = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Alarga", validTo: null });
    expect(!into.ok && into.error.code).toBe("assignment_overlap");
    expect(!over.ok && over.error.code).toBe("assignment_overlap");
    expect(!contained.ok && contained.error.code).toBe("assignment_overlap");
    const contiguous = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Alarga", validTo: "2026-01-31", validFrom: "2026-01-01" });
    expect(contiguous.ok).toBe(true);
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => [r.validFrom, r.validTo])).toEqual([["2026-02-01", null], ["2026-01-01", "2026-01-31"]]);
  });

  it("refuses an archived or missing target operation but allows correcting an archived equipment history", async () => {
    const { h, s, first } = await setup();
    const archived = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "x", operationId: "opx" });
    const missing = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "x", operationId: "missing" });
    expect(!archived.ok && archived.error.code).toBe("operation_archived");
    expect(!missing.ok && missing.error.code).toBe("not_found");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Baja" });
    const history = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Fecha", validTo: "2026-02-02" });
    expect(history.ok).toBe(true);
  });

  it("needs catalog.write at the source operation and, when it changes, at the target operation", async () => {
    const { h, s, first } = await setup();
    const input = { assignmentId: first.id, reason: "Corrige", operationId: "op2" };
    const sourceOnly = await h.correctAssignment.execute({ ...input, actor: h.analystAt("op1") });
    const targetOnly = await h.correctAssignment.execute({ ...input, actor: h.analystAt("op2") });
    expect(!sourceOnly.ok && sourceOnly.error.code).toBe("forbidden");
    expect(!targetOnly.ok && targetOnly.error.code).toBe("forbidden");
    expect((await h.assignmentsOf(s.eq1.id))[0]?.operationId).toBe("op1");
    const days = await h.correctAssignment.execute({ assignmentId: first.id, reason: "Corrige", validFrom: "2026-01-11", actor: h.analystAt("op1") });
    expect(days.ok).toBe(true);
  });

  it("answers not found to a tenant-wide writer and forbidden to a scoped one for a missing id, and treats other tenants as missing", async () => {
    const { h, first } = await setup();
    const wide = await h.correctAssignment.execute({ actor: h.admin, assignmentId: "missing", reason: "x", kind: "spare" });
    const scoped = await h.correctAssignment.execute({ actor: h.adminAt("op1"), assignmentId: "missing", reason: "x", kind: "spare" });
    const foreign = await h.correctAssignment.execute({ actor: h.adminB, assignmentId: first.id, reason: "x", kind: "spare" });
    expect(!wide.ok && wide.error.code).toBe("not_found");
    expect(!scoped.ok && scoped.error.code).toBe("forbidden");
    expect(!foreign.ok && foreign.error.code).toBe("not_found");
  });
});
