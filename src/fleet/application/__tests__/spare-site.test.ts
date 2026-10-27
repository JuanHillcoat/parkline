import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant } from "./support/harness";

/**
 * ADR-0013: a spare ("muleto") belongs to a SITE. Fake organization: op1 = bu1 / s1, op2 = bu1 / s2,
 * op3 = bu2 / s3, opx archived; sites s1, s2, s3, sx (archived) of t-a, s-b of t-b.
 */
const setup = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  return { h, s };
};

const code = (result: { ok: boolean } | { ok: false; error: { code: string } }): string =>
  "error" in result ? result.error.code : "ok";

describe("AssignEquipment to a site", () => {
  it("stores a spare with no operation and no division, audited at the site", async () => {
    const { h, s } = await setup();
    const spare = await h.assignSpare(s.eq1.id, "s2", "2026-02-01");
    expect(spare).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: "s2", validTo: null });
    const [entry] = h.auditOf("fleet.assignment.create");
    expect(entry).toMatchObject({ siteId: "s2", subjectEquipmentId: s.eq1.id, actorRole: "admin" });
    expect(entry?.operationId).toBeUndefined();
    expect(entry?.businessUnitId).toBeUndefined();
  });

  it("refuses an archived site and a missing one, and a site of another tenant, storing nothing", async () => {
    const { h, s } = await setup();
    const input = { actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01" };
    expect(code(await h.assignEquipment.execute({ ...input, target: { siteId: "sx" } }))).toBe("site_archived");
    expect(code(await h.assignEquipment.execute({ ...input, target: { siteId: "missing" } }))).toBe("not_found");
    expect(code(await h.assignEquipment.execute({ ...input, target: { siteId: "s-b" } }))).toBe("not_found");
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(0);
  });

  it("needs a writer whose grant covers the whole company: a division or an operation never matches a site spare", async () => {
    const { h, s } = await setup();
    const input = { equipmentId: s.eq1.id, target: { siteId: "s1" }, day: "2026-02-01" };
    for (const actor of [h.analystAt("op1"), h.adminAt("op1"), actorWith([grant("admin", "business_unit", "bu1")])]) {
      expect(code(await h.assignEquipment.execute({ ...input, actor }))).toBe("forbidden");
    }
    expect(code(await h.assignEquipment.execute({ ...input, actor: h.analyst }))).toBe("ok");
  });

  it("answers forbidden to a scoped writer for a missing site, so ids cannot be probed", async () => {
    const { h, s } = await setup();
    const input = { equipmentId: s.eq1.id, day: "2026-02-01" };
    expect(code(await h.assignEquipment.execute({ ...input, actor: h.adminAt("op1"), target: { siteId: "missing" } }))).toBe("forbidden");
    expect(code(await h.assignEquipment.execute({ ...input, actor: h.adminAt("op1"), target: { siteId: "s1" } }))).toBe("forbidden");
  });

  it("requires a reason for a past day, like any first assignment", async () => {
    const { h, s } = await setup();
    const input = { actor: h.admin, equipmentId: s.eq1.id, target: { siteId: "s1" }, day: "2025-12-31" };
    expect(code(await h.assignEquipment.execute(input))).toBe("reason_required");
    expect(code(await h.assignEquipment.execute({ ...input, reason: "Cargado tarde" }))).toBe("ok");
  });

  it("keeps the overlap rule between a spare and an operation assignment of the same equipment", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    expect(code(await h.assignEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, target: { siteId: "s1" }, day: "2026-02-01" }))).toBe("open_assignment_exists");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    expect(code(await h.assignEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, target: { siteId: "s1" }, day: "2026-01-20", reason: "Atrasado" }))).toBe("assignment_overlap");
  });
});

describe("MoveEquipment between operations and sites", () => {
  it("moves an operation to a site as a spare", async () => {
    const { h, s } = await setup();
    const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
    const result = await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, target: { siteId: "s2" }, day: "2026-02-01", reason: "Sin trabajo" });
    expect(result.ok && result.value.closed).toMatchObject({ id: first.id, validTo: "2026-01-31" });
    expect(result.ok && result.value.opened).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: "s2", validFrom: "2026-02-01" });
    expect(h.auditOf("fleet.assignment.move")).toMatchObject([
      { siteId: "s2", reason: "Sin trabajo", before: { operationId: "op1" }, after: { operationId: null, siteId: "s2", kind: "spare" } },
    ]);
  });

  it("moves a site spare to an operation, active again", async () => {
    const { h, s } = await setup();
    await h.assignSpare(s.eq1.id, "s1", "2026-01-10");
    const result = await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, target: { operationId: "op3" }, day: "2026-02-01", reason: "Cubre la operacion" });
    expect(result.ok && result.value.opened).toMatchObject({ kind: "active", operationId: "op3", businessUnitId: "bu2", siteId: "s3" });
  });

  it("moves a site spare to another site and refuses the same site", async () => {
    const { h, s } = await setup();
    await h.assignSpare(s.eq1.id, "s1", "2026-01-10");
    const input = { actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Traslado" };
    expect(code(await h.moveEquipment.execute({ ...input, target: { siteId: "s1" } }))).toBe("same_site");
    const moved = await h.moveEquipment.execute({ ...input, target: { siteId: "s2" } });
    expect(moved.ok && moved.value.opened).toMatchObject({ kind: "spare", siteId: "s2", operationId: null });
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => [r.siteId, r.validTo])).toEqual([["s2", null], ["s1", "2026-01-31"]]);
  });

  it("refuses an archived or missing site as the target, changing nothing", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const input = { actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Traslado" };
    expect(code(await h.moveEquipment.execute({ ...input, target: { siteId: "sx" } }))).toBe("site_archived");
    expect(code(await h.moveEquipment.execute({ ...input, target: { siteId: "missing" } }))).toBe("not_found");
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => r.validTo)).toEqual([null]);
  });

  it("needs write at the target AND at the place being left, a site spare included", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const input = { equipmentId: s.eq1.id, day: "2026-02-01", reason: "Traslado" };
    expect(code(await h.moveEquipment.execute({ ...input, actor: h.analystAt("op1"), target: { siteId: "s1" } }))).toBe("forbidden");
    await h.moveEquipment.execute({ ...input, actor: h.admin, target: { siteId: "s1" } });
    expect(code(await h.moveEquipment.execute({ ...input, actor: h.analystAt("op2"), target: { operationId: "op2" }, day: "2026-03-01" }))).toBe("forbidden");
  });

  it("keeps the reason mandatory when leaving or reaching a site", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    expect(code(await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, target: { siteId: "s1" }, day: "2026-02-01", reason: " " }))).toBe("reason_required");
  });
});

describe("CorrectAssignment across targets", () => {
  it("turns an operation assignment into a site spare and back, keeping the days", async () => {
    const { h, s } = await setup();
    const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
    const toSite = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "Era muleto", target: { siteId: "s1" } });
    expect(toSite.ok && toSite.value).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: "s1", validFrom: "2026-01-10" });
    const back = await h.correctAssignment.execute({ actor: h.admin, assignmentId: first.id, reason: "No era", target: { operationId: "op2" } });
    expect(back.ok && back.value).toMatchObject({ kind: "active", operationId: "op2", businessUnitId: "bu1", siteId: "s2" });
  });

  it("corrects only the days of a site spare when no target is given", async () => {
    const { h, s } = await setup();
    const spare = await h.assignSpare(s.eq1.id, "s1", "2026-01-10");
    const result = await h.correctAssignment.execute({ actor: h.admin, assignmentId: spare.id, reason: "Fecha", validFrom: "2026-01-12" });
    expect(result.ok && result.value).toMatchObject({ kind: "spare", operationId: null, siteId: "s1", validFrom: "2026-01-12" });
  });

  it("refuses the same target as no changes and an archived site as the new target", async () => {
    const { h, s } = await setup();
    const spare = await h.assignSpare(s.eq1.id, "s1", "2026-01-10");
    expect(code(await h.correctAssignment.execute({ actor: h.admin, assignmentId: spare.id, reason: "x", target: { siteId: "s1" } }))).toBe("no_changes");
    expect(code(await h.correctAssignment.execute({ actor: h.admin, assignmentId: spare.id, reason: "x", target: { siteId: "sx" } }))).toBe("site_archived");
  });

  it("will not reopen a closed site spare at a site archived later, but still corrects its history", async () => {
    const { h, s } = await setup();
    const spare = await h.assignSpare(s.eq1.id, "s1", "2026-01-10");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-01-31", reason: "Fin" });
    h.operations.archiveSite("s1", START_DAY);
    const dates = await h.correctAssignment.execute({ actor: h.admin, assignmentId: spare.id, reason: "Fecha", validFrom: "2026-01-11" });
    expect(dates.ok).toBe(true);
    const reopen = await h.correctAssignment.execute({ actor: h.admin, assignmentId: spare.id, reason: "Reabre", validTo: null });
    expect(code(reopen)).toBe("site_archived");
  });
});

const START_DAY = new Date("2026-01-01T09:00:00Z");

describe("ReplaceEquipment leaving a spare at the site", () => {
  it("puts the outgoing equipment as a spare of the site of the operation it leaves, with no operation", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op2", "2026-01-10");
    const result = await h.replaceEquipment.execute({
      actor: h.analyst, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "2026-02-01", outgoing: "spare", reason: "Llega el nuevo",
    });
    expect(result.ok && result.value.incoming).toMatchObject({ kind: "active", operationId: "op2", siteId: "s2" });
    expect(result.ok && result.value.outgoing).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: "s2", validFrom: "2026-02-01" });
    const audit = h.auditOf("fleet.assignment.replace");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ after: { choice: "spare", outgoing: { operationId: null, siteId: "s2", kind: "spare" } } });
  });

  it("refuses to replace a site spare: it has no operation for the incoming equipment to take", async () => {
    const { h, s } = await setup();
    await h.assignSpare(s.eq1.id, "s1", "2026-01-10");
    const result = await h.replaceEquipment.execute({
      actor: h.admin, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "2026-02-01", outgoing: "spare", reason: "x",
    });
    expect(code(result)).toBe("invalid_assignment_target");
    expect(await h.assignmentsOf(s.c43.id)).toHaveLength(0);
    expect(await h.assignmentsOf(s.eq1.id)).toHaveLength(1);
  });

  it("refuses to leave a spare at an archived site and changes nothing", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    h.operations.archiveSite("s1", START_DAY);
    const result = await h.replaceEquipment.execute({
      actor: h.analyst, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "2026-02-01", outgoing: "spare", reason: "Llega el nuevo",
    });
    expect(code(result)).toBe("site_archived");
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => [r.kind, r.validTo])).toEqual([["active", null]]);
    expect(await h.assignmentsOf(s.c43.id)).toHaveLength(0);
    expect(h.auditOf("fleet.assignment.replace")).toHaveLength(0);
  });

  it("still retires the outgoing equipment as before", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const result = await h.replaceEquipment.execute({
      actor: h.analyst, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "2026-02-01", outgoing: "retire", reason: "Baja",
    });
    expect(result.ok && result.value.retired).toBe(true);
    expect((await h.assignmentsOf(s.eq1.id)).map((r) => [r.kind, r.validTo])).toEqual([["active", "2026-01-31"]]);
  });
});

describe("history and lists of a spare", () => {
  it("shows the spare with no operation and its site in the history, to a wide reader only", async () => {
    const { h, s } = await setup();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, target: { siteId: "s1" }, day: "2026-02-01", reason: "Sin trabajo" });
    const wide = h.orThrow(await h.listEquipmentAssignments.execute({ actor: h.admin, equipmentId: s.eq1.id }));
    expect(wide.map((a) => [a.operationId, a.siteId, a.kind])).toEqual([[null, "s1", "spare"], ["op1", "s1", "active"]]);
    const scoped = h.orThrow(await h.listEquipmentAssignments.execute({ actor: h.adminAt("op1"), equipmentId: s.eq1.id }));
    expect(scoped.map((a) => a.kind)).toEqual(["active"]);
  });

  it("lists the spare with the site and a null operation in the equipment list", async () => {
    const { h, s } = await setup();
    await h.assignSpare(s.eq1.id, "s3", "2026-01-10");
    const rows = h.orThrow(await h.listEquipment.execute({ actor: h.admin }));
    expect(rows.find((r) => r.id === s.eq1.id)?.assignment).toEqual({
      operationId: null, siteId: "s3", businessUnitId: null, kind: "spare", validFrom: "2026-01-10",
    });
  });
});
