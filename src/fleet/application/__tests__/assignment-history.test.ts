import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant } from "./support/harness";

const history = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  await h.assign(s.eq1.id, "op1", "2026-01-10");
  await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, operationId: "op2", day: "2026-03-01", reason: "Pedido" });
  await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.eq1.id, operationId: "op3", day: "2026-05-01", reason: "Pedido" });
  return { h, s };
};

describe("ListEquipmentAssignments", () => {
  it("lists the whole history of one equipment, newest first", async () => {
    const { h, s } = await history();
    const result = await h.listEquipmentAssignments.execute({ actor: h.admin, equipmentId: s.eq1.id });
    expect(result.ok && result.value.map((a) => [a.operationId, a.validFrom, a.validTo])).toEqual([
      ["op3", "2026-05-01", null],
      ["op2", "2026-03-01", "2026-04-30"],
      ["op1", "2026-01-10", "2026-02-28"],
    ]);
  });

  it("returns an empty list for an equipment that was never assigned and does not mix equipment", async () => {
    const { h, s } = await history();
    const result = await h.listEquipmentAssignments.execute({ actor: h.admin, equipmentId: s.c43.id });
    expect(result.ok && result.value).toEqual([]);
  });

  it("shows a read-only actor at tenant scope everything, and a scoped reader only the operations it may read", async () => {
    const { h, s } = await history();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    const scoped = actorWith([grant("viewer", "operation", "op2")]);
    const all = await h.listEquipmentAssignments.execute({ actor: viewer, equipmentId: s.eq1.id });
    const some = await h.listEquipmentAssignments.execute({ actor: scoped, equipmentId: s.eq1.id });
    expect(all.ok && all.value).toHaveLength(3);
    expect(some.ok && some.value.map((a) => a.operationId)).toEqual(["op2"]);
  });

  it("answers the same empty list to a scoped reader for a missing id and for an equipment it cannot see", async () => {
    const { h, s } = await history();
    const scoped = actorWith([grant("viewer", "operation", "op9")]);
    const known = await h.listEquipmentAssignments.execute({ actor: scoped, equipmentId: s.eq1.id });
    const missing = await h.listEquipmentAssignments.execute({ actor: scoped, equipmentId: "missing" });
    expect(known.ok && known.value).toEqual([]);
    expect(missing).toEqual(known);
  });

  it("answers not found to a tenant-wide reader for a missing id", async () => {
    const { h } = await history();
    const result = await h.listEquipmentAssignments.execute({ actor: h.admin, equipmentId: "missing" });
    expect(!result.ok && result.error.code).toBe("not_found");
  });

  it("never shows the assignments of another tenant", async () => {
    const { h, s } = await history();
    const result = await h.listEquipmentAssignments.execute({ actor: h.adminB, equipmentId: s.eq1.id });
    expect(!result.ok && result.error.code).toBe("not_found");
  });

  it("refuses an inactive actor", async () => {
    const { h, s } = await history();
    const inactive = actorWith([grant("admin", "tenant", "t-a")], { active: false });
    const result = await h.listEquipmentAssignments.execute({ actor: inactive, equipmentId: s.eq1.id });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("writes no audit entry", async () => {
    const { h, s } = await history();
    const before = h.audit.entries.length;
    await h.listEquipmentAssignments.execute({ actor: h.admin, equipmentId: s.eq1.id });
    expect(h.audit.entries).toHaveLength(before);
  });
});
