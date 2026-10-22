import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../shared/domain/ports/unit-of-work";
import type { FleetDeps } from "../deps";
import type { FleetTx } from "../ports/fleet-tx";
import { ReplaceEquipment } from "../use-cases/replace-equipment";
import { actorWith, createHarness, grant, START, type Harness } from "./support/harness";

/** EQ-0001 sits in op1 since 2026-01-10; C-043 is free and will replace it. */
const setup = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const old = await h.assign(s.eq1.id, "op1", "2026-01-10");
  const input = {
    actor: h.analyst, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id,
    day: "2026-02-01", outgoing: "spare", reason: "Llega el equipo nuevo",
  };
  return { h, s, old, input };
};

const shape = (rows: readonly { equipmentId: string; operationId: string; kind: string; validFrom: string; validTo: string | null }[]) =>
  rows.map((r) => [r.equipmentId, r.operationId, r.kind, r.validFrom, r.validTo]);

describe("ReplaceEquipment keeping the outgoing equipment as a spare", () => {
  it("assigns the incoming one as active from the day and turns the outgoing one into a spare of the same operation", async () => {
    const { h, s, old, input } = await setup();
    const result = await h.replaceEquipment.execute(input);
    expect(result.ok && result.value).toMatchObject({
      retired: false,
      incoming: { equipmentId: s.c43.id, operationId: "op1", kind: "active", validFrom: "2026-02-01", validTo: null },
      outgoing: { equipmentId: s.eq1.id, operationId: "op1", kind: "spare", validFrom: "2026-02-01", validTo: null },
    });
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([
      [s.eq1.id, "op1", "spare", "2026-02-01", null],
      [s.eq1.id, "op1", "active", "2026-01-10", "2026-01-31"],
    ]);
    expect((await h.assignmentsOf(s.eq1.id))[1]?.id).toBe(old.id);
    expect(shape(await h.assignmentsOf(s.c43.id))).toEqual([[s.c43.id, "op1", "active", "2026-02-01", null]]);
  });

  it("writes one sensitive replace entry with the reason and no archive entry", async () => {
    const { h, s, input } = await setup();
    await h.replaceEquipment.execute(input);
    expect(h.auditOf("fleet.assignment.replace")).toMatchObject([
      {
        reason: "Llega el equipo nuevo", subjectEquipmentId: s.c43.id, operationId: "op1", actorRole: "fleet_analyst",
        before: { equipmentId: s.eq1.id, kind: "active", validTo: null },
        after: { choice: "spare" },
      },
    ]);
    expect(h.auditOf("fleet.archive")).toHaveLength(0);
    expect((await h.store.read((tx) => tx.equipment.findById("t-a", s.eq1.id)))?.archivedAt).toBeNull();
  });

  it("works for an actor that can write the operation but cannot archive", async () => {
    const { h, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, actor: h.admin });
    expect(result.ok).toBe(true);
  });
});

describe("ReplaceEquipment retiring the outgoing equipment", () => {
  it("closes the outgoing assignment the day before and archives it with the reason, like a normal archive", async () => {
    const { h, s, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, outgoing: "retire" });
    expect(result.ok && result.value).toMatchObject({
      retired: true,
      incoming: { equipmentId: s.c43.id, kind: "active", validFrom: "2026-02-01" },
      outgoing: { equipmentId: s.eq1.id, validFrom: "2026-01-10", validTo: "2026-01-31" },
    });
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([[s.eq1.id, "op1", "active", "2026-01-10", "2026-01-31"]]);
    expect((await h.store.read((tx) => tx.equipment.findById("t-a", s.eq1.id)))?.archivedAt).toEqual(START);
    expect(h.auditOf("fleet.archive")).toMatchObject([
      { entityType: "equipment", entityId: s.eq1.id, reason: "Llega el equipo nuevo", actorRole: "fleet_analyst" },
    ]);
    expect(h.auditOf("fleet.assignment.replace")).toHaveLength(1);
  });

  it("writes the replace entry last", async () => {
    const { h, input } = await setup();
    const before = h.audit.entries.length;
    await h.replaceEquipment.execute({ ...input, outgoing: "retire" });
    expect(h.audit.entries.slice(before).map((e) => e.action)).toEqual(["fleet.archive", "fleet.assignment.replace"]);
  });

  it("is refused to an actor without catalog.archive and changes nothing", async () => {
    const { h, s, input } = await setup();
    for (const actor of [h.admin, h.analystAt("op1"), h.adminAt("op1")]) {
      const result = await h.replaceEquipment.execute({ ...input, actor, outgoing: "retire" });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([[s.eq1.id, "op1", "active", "2026-01-10", null]]);
    expect(await h.assignmentsOf(s.c43.id)).toHaveLength(0);
    expect((await h.store.read((tx) => tx.equipment.findById("t-a", s.eq1.id)))?.archivedAt).toBeNull();
    expect(h.auditOf("fleet.assignment.replace")).toHaveLength(0);
  });
});

describe("ReplaceEquipment input rules", () => {
  it.each([undefined, "", "keep", "SPARE", "baja"])("requires the outgoing choice: %j is a typed validation error", async (outgoing) => {
    const { h, s, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, outgoing });
    expect(!result.ok && result.error.code).toBe("outgoing_required");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toHaveLength(1);
    expect(await h.assignmentsOf(s.c43.id)).toHaveLength(0);
  });

  it("requires a reason, a valid day and two different equipment", async () => {
    const { h, s, input } = await setup();
    const reason = await h.replaceEquipment.execute({ ...input, reason: " " });
    const day = await h.replaceEquipment.execute({ ...input, day: "soon" });
    const same = await h.replaceEquipment.execute({ ...input, incomingEquipmentId: s.eq1.id });
    expect(!reason.ok && reason.error.code).toBe("reason_required");
    expect(!day.ok && day.error.code).toBe("invalid_day");
    expect(!same.ok && same.error.code).toBe("same_equipment");
  });

  it("refuses a day that is not after the start of the outgoing assignment", async () => {
    const { h, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, day: "2026-01-10" });
    expect(!result.ok && result.error.code).toBe("invalid_period");
  });

  it("accepts a past day with the mandatory reason", async () => {
    const { h, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, day: "2026-01-11" });
    expect(result.ok && result.value.outgoing.validFrom).toBe("2026-01-11");
  });

  it("refuses an outgoing equipment with no open assignment", async () => {
    const { h, s, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, outgoingEquipmentId: s.c43.id, incomingEquipmentId: s.eq1.id });
    expect(!result.ok && result.error.code).toBe("no_open_assignment");
  });

  it("refuses an archived or already assigned incoming equipment", async () => {
    const { h, s, input } = await setup();
    const third = h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-0003")));
    await h.assign(third.id, "op2", "2026-01-15");
    const assigned = await h.replaceEquipment.execute({ ...input, incomingEquipmentId: third.id });
    expect(!assigned.ok && assigned.error.code).toBe("open_assignment_exists");
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Error" });
    const archived = await h.replaceEquipment.execute(input);
    expect(!archived.ok && archived.error.code).toBe("archived");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toHaveLength(1);
  });

  it("refuses an incoming equipment whose recorded history overlaps the day", async () => {
    const { h, s, input } = await setup();
    await h.assign(s.c43.id, "op2", "2026-01-12");
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.c43.id, day: "2026-02-05", reason: "Fin" });
    const result = await h.replaceEquipment.execute(input);
    expect(!result.ok && result.error.code).toBe("assignment_overlap");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([[s.eq1.id, "op1", "active", "2026-01-10", null]]);
  });

  it("answers not found for a missing incoming equipment and nothing changes", async () => {
    const { h, s, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, incomingEquipmentId: "missing" });
    expect(!result.ok && result.error.code).toBe("not_found");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toHaveLength(1);
  });
});

describe("ReplaceEquipment authorization and tenant isolation", () => {
  it("needs catalog.write at the operation of the outgoing assignment", async () => {
    const { h, input } = await setup();
    const elsewhere = await h.replaceEquipment.execute({ ...input, actor: h.analystAt("op2") });
    const viewer = await h.replaceEquipment.execute({ ...input, actor: actorWith([grant("viewer", "tenant", "t-a")]) });
    expect(!elsewhere.ok && elsewhere.error.code).toBe("forbidden");
    expect(!viewer.ok && viewer.error.code).toBe("forbidden");
    expect((await h.replaceEquipment.execute({ ...input, actor: h.analystAt("op1") })).ok).toBe(true);
  });

  it("does not reach the equipment of another tenant", async () => {
    const { h, s, input } = await setup();
    const result = await h.replaceEquipment.execute({ ...input, actor: h.analystB });
    expect(!result.ok && result.error.code).toBe("no_open_assignment");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toHaveLength(1);
  });
});

const failing = (h: Harness, change: (tx: FleetTx) => FleetTx): FleetDeps => {
  const unitOfWork: UnitOfWork<FleetTx> = { run: (work) => h.deps.unitOfWork.run((tx) => work(change(tx))) };
  return { ...h.deps, unitOfWork };
};

describe("ReplaceEquipment is atomic", () => {
  it("leaves nothing behind when the archive step fails after the assignments were written", async () => {
    const { h, s, input } = await setup();
    const deps = failing(h, (tx) => ({
      ...tx,
      equipment: Object.assign(Object.create(tx.equipment) as typeof tx.equipment, { setArchivedAt: () => Promise.resolve("state_changed" as const) }),
    }));
    const before = h.audit.entries.length;
    const result = await new ReplaceEquipment(deps).execute({ ...input, outgoing: "retire" });
    expect(!result.ok && result.error.code).toBe("already_archived");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([[s.eq1.id, "op1", "active", "2026-01-10", null]]);
    expect(await h.assignmentsOf(s.c43.id)).toHaveLength(0);
    expect(h.audit.entries).toHaveLength(before);
  });

  it("leaves nothing behind when the audit write fails", async () => {
    const { h, s, input } = await setup();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.replaceEquipment.execute(input)).rejects.toThrow("audit down");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([[s.eq1.id, "op1", "active", "2026-01-10", null]]);
    expect(await h.assignmentsOf(s.c43.id)).toHaveLength(0);
  });

  it("leaves nothing behind when the incoming assignment is rejected by the overlap constraint", async () => {
    const { h, s, input } = await setup();
    const deps = failing(h, (tx) => ({
      ...tx,
      assignments: Object.assign(Object.create(tx.assignments) as typeof tx.assignments, {
        findOpen: (tenantId: string, equipmentId: string) =>
          equipmentId === s.c43.id ? Promise.resolve(null) : tx.assignments.findOpen(tenantId, equipmentId),
        add: () => Promise.resolve("overlap" as const),
      }),
    }));
    const result = await new ReplaceEquipment(deps).execute(input);
    expect(!result.ok && result.error.code).toBe("assignment_overlap");
    expect(shape(await h.assignmentsOf(s.eq1.id))).toEqual([[s.eq1.id, "op1", "active", "2026-01-10", null]]);
  });
});
