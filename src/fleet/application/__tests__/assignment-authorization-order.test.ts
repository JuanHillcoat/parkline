import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

/**
 * Ids a refused actor must not be able to tell apart: missing, assigned, free and archived equipment,
 * and operations that are missing, reachable by others, archived or of another tenant.
 * EQ-0001 sits in op1; C-043 is free; EQ-DEAD is archived.
 */
const probe = async (h: Harness) => {
  const s = await h.seedTenantA();
  const first = await h.assign(s.eq1.id, "op1", "2026-01-10");
  const dead = h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-DEAD")));
  await h.archiveEquipment.execute({ actor: h.analyst, id: dead.id, reason: "Error" });
  return {
    s,
    equipmentIds: ["missing", s.eq1.id, s.c43.id, dead.id],
    assignmentIds: ["missing", first.id],
    operationIds: ["missing", "op1", "op3", "opx", "opb"],
  };
};

/** Neither can write op1/op3, and the second one writes only op2. */
const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
const elsewhere = actorWith([grant("fleet_analyst", "operation", "op2")]);

describe.each([
  ["a viewer", viewer],
  ["a writer of another operation", elsewhere],
])("%s is answered the same for every id", (_name, actor) => {
  it("assign: any equipment id and any target operation id but its own", async () => {
    const h = createHarness();
    const { s, equipmentIds, operationIds } = await probe(h);
    for (const equipmentId of equipmentIds) {
      expect(code(await h.assignEquipment.execute({ actor, equipmentId, operationId: "op1", kind: "active", day: "2026-02-01" }))).toBe("forbidden");
    }
    for (const operationId of operationIds) {
      expect(code(await h.assignEquipment.execute({ actor, equipmentId: s.c43.id, operationId, kind: "active", day: "2026-02-01" }))).toBe("forbidden");
    }
  });

  it("move, end, replace: any equipment id", async () => {
    const h = createHarness();
    const { s, equipmentIds } = await probe(h);
    for (const equipmentId of equipmentIds) {
      expect(code(await h.moveEquipment.execute({ actor, equipmentId, operationId: "op3", day: "2026-02-01", reason: "x" }))).toBe("forbidden");
      expect(code(await h.moveEquipment.execute({ actor, equipmentId, operationId: "op2", day: "2026-02-01", reason: "x" }))).toBe("forbidden");
      expect(code(await h.endAssignment.execute({ actor, equipmentId, day: "2026-02-01", reason: "x" }))).toBe("forbidden");
      const replace = { actor, incomingEquipmentId: s.c43.id, outgoingEquipmentId: equipmentId, day: "2026-02-01", outgoing: "spare", reason: "x" };
      expect(code(await h.replaceEquipment.execute(replace))).toBe("forbidden");
    }
  });

  it("move: any target operation id", async () => {
    const h = createHarness();
    const { s, operationIds } = await probe(h);
    for (const operationId of operationIds) {
      expect(code(await h.moveEquipment.execute({ actor, equipmentId: s.eq1.id, operationId, day: "2026-02-01", reason: "x" }))).toBe("forbidden");
    }
  });

  it("correct: any assignment id", async () => {
    const h = createHarness();
    const { assignmentIds } = await probe(h);
    for (const assignmentId of assignmentIds) {
      expect(code(await h.correctAssignment.execute({ actor, assignmentId, reason: "x", kind: "spare" }))).toBe("forbidden");
    }
  });

  it("does not let invalid input answer before the authorization does", async () => {
    const h = createHarness();
    const { s } = await probe(h);
    expect(code(await h.assignEquipment.execute({ actor, equipmentId: s.c43.id, operationId: "op1", kind: "loan", day: "nope" }))).toBe("forbidden");
    expect(code(await h.moveEquipment.execute({ actor, equipmentId: s.eq1.id, operationId: "op3", day: "nope", reason: "" }))).toBe("forbidden");
    expect(code(await h.replaceEquipment.execute({ actor, incomingEquipmentId: s.c43.id, outgoingEquipmentId: s.eq1.id, day: "nope", reason: "" }))).toBe("forbidden");
  });
});

describe("a tenant-wide writer keeps the typed errors", () => {
  it("is told not found for a missing id", async () => {
    const h = createHarness();
    const { s, assignmentIds } = await probe(h);
    expect(code(await h.assignEquipment.execute({ actor: h.admin, equipmentId: "missing", operationId: "op1", kind: "active", day: "2026-02-01" }))).toBe("not_found");
    expect(code(await h.assignEquipment.execute({ actor: h.admin, equipmentId: s.c43.id, operationId: "missing", kind: "active", day: "2026-02-01" }))).toBe("not_found");
    expect(code(await h.correctAssignment.execute({ actor: h.admin, assignmentId: assignmentIds[0] ?? "", reason: "x", kind: "spare" }))).toBe("not_found");
    expect(code(await h.endAssignment.execute({ actor: h.admin, equipmentId: "missing", day: "2026-02-01", reason: "x" }))).toBe("no_open_assignment");
  });
});
