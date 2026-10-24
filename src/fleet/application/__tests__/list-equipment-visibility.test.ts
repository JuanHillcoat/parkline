import { describe, expect, it } from "vitest";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

/**
 * D6: equipment is visible to an actor whose `catalog.read` covers the position of its OPEN assignment;
 * equipment with no open assignment is visible only tenant-wide. Positions of the fake organization:
 * op1 = division bu1 / site s1, op2 = bu1 / s2, op3 = bu2 / s3.
 * Codes: EQ-0001 in op1, EQ-0003 (spare) in op2, C-043 in op3, EQ-0004 never assigned.
 */
const seed = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const create = async (code: string) =>
    h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, code)));
  const spare = await create("EQ-0003");
  const idle = await create("EQ-0004");
  await h.assign(s.eq1.id, "op1", "2026-01-10");
  await h.assign(spare.id, "op2", "2026-02-01", { kind: "spare" });
  await h.assign(s.c43.id, "op3", "2026-03-01");
  return { h, s, spare, idle };
};

const codesFor = async (h: Harness, actor: Actor, includeArchived?: boolean): Promise<string[]> => {
  const rows = h.orThrow(await h.listEquipment.execute({ actor, includeArchived }));
  return rows.map((row) => row.internalCode);
};

describe("ListEquipment visibility follows the open assignment (D6)", () => {
  it("shows a division-scoped manager the equipment placed in its division only", async () => {
    const { h } = await seed();
    const manager = actorWith([grant("manager", "business_unit", "bu1")]);
    expect(await codesFor(h, manager)).toEqual(["EQ-0001", "EQ-0003"]);
  });

  it("shows an operation-scoped supervisor the equipment of that operation only", async () => {
    const { h } = await seed();
    const supervisor = actorWith([grant("supervisor", "operation", "op2")]);
    expect(await codesFor(h, supervisor)).toEqual(["EQ-0003"]);
  });

  it("shows a site-scoped reader the equipment placed at that site only", async () => {
    const { h } = await seed();
    expect(await codesFor(h, actorWith([grant("viewer", "site", "s3")]))).toEqual(["C-043"]);
    expect(await codesFor(h, actorWith([grant("viewer", "site", "s1")]))).toEqual(["EQ-0001"]);
  });

  it("shows every tenant-wide reader everything, the never assigned equipment included", async () => {
    const { h } = await seed();
    for (const role of ["admin", "fleet_analyst", "manager", "supervisor", "viewer"]) {
      expect(await codesFor(h, actorWith([grant(role, "tenant", "t-a")]))).toEqual(["C-043", "EQ-0001", "EQ-0003", "EQ-0004"]);
    }
  });

  it("hides equipment without an open assignment from every scoped reader", async () => {
    const { h, s } = await seed();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    const scoped = [
      actorWith([grant("manager", "business_unit", "bu1")]),
      actorWith([grant("supervisor", "operation", "op1")]),
      actorWith([grant("viewer", "site", "s1")]),
    ];
    for (const actor of scoped) expect(await codesFor(h, actor)).not.toContain("EQ-0001");
    expect(await codesFor(h, actorWith([grant("viewer", "business_unit", "bu1")]))).not.toContain("EQ-0004");
    expect(await codesFor(h, h.admin)).toContain("EQ-0001");
  });

  it("follows the equipment when it moves: the new position sees it, the old one no longer does", async () => {
    const { h, s } = await seed();
    await h.moveEquipment.execute({ actor: h.admin, equipmentId: s.c43.id, operationId: "op1", day: "2026-04-01", reason: "Pedido" });
    expect(await codesFor(h, actorWith([grant("supervisor", "operation", "op3")]))).toEqual([]);
    expect(await codesFor(h, actorWith([grant("supervisor", "operation", "op1")]))).toEqual(["C-043", "EQ-0001"]);
  });

  it("never lets a scoped actor learn about archived equipment, even when it asks for it", async () => {
    const { h, s, idle } = await seed();
    await h.archiveEquipment.execute({ actor: h.analyst, id: idle.id, reason: "Error" });
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Baja" });
    const scoped = actorWith([grant("fleet_analyst", "business_unit", "bu1")]);
    expect(await codesFor(h, scoped, true)).toEqual(["EQ-0003"]);
    expect(await codesFor(h, h.analyst, true)).toEqual(["C-043", "EQ-0001", "EQ-0003", "EQ-0004"]);
    expect(await codesFor(h, h.analyst)).toEqual(["C-043", "EQ-0003"]);
  });

  it("never shows equipment of another tenant, to a tenant-wide or a scoped actor of that tenant", async () => {
    const { h } = await seed();
    expect(await codesFor(h, h.adminB)).toEqual([]);
    const scopedB = actorWith([grant("viewer", "operation", "op1")], { tenantId: "t-b" });
    expect(await codesFor(h, scopedB)).toEqual([]);
  });

  it("returns an empty list, not an error, to a scoped actor that covers nothing", async () => {
    const { h } = await seed();
    const result = await h.listEquipment.execute({ actor: actorWith([grant("viewer", "operation", "op9")]) });
    expect(result.ok && result.value).toEqual([]);
  });
});

describe("ListEquipment returns the current assignment summary", () => {
  it("gives the operation, site, division, kind and start day of the open assignment, or null", async () => {
    const { h } = await seed();
    const rows = h.orThrow(await h.listEquipment.execute({ actor: h.admin }));
    const byCode = Object.fromEntries(rows.map((row) => [row.internalCode, row.assignment]));
    expect(byCode["EQ-0001"]).toEqual({ operationId: "op1", siteId: "s1", businessUnitId: "bu1", kind: "active", validFrom: "2026-01-10" });
    expect(byCode["EQ-0003"]).toEqual({ operationId: "op2", siteId: "s2", businessUnitId: "bu1", kind: "spare", validFrom: "2026-02-01" });
    expect(byCode["EQ-0004"]).toBeNull();
  });

  it("keeps the equipment fields and shows null after the assignment ends", async () => {
    const { h, s } = await seed();
    await h.endAssignment.execute({ actor: h.admin, equipmentId: s.eq1.id, day: "2026-02-01", reason: "Fin" });
    const rows = h.orThrow(await h.listEquipment.execute({ actor: h.admin }));
    const row = rows.find((r) => r.id === s.eq1.id);
    expect(row).toMatchObject({ internalCode: "EQ-0001", supplierId: s.supplierA.id, archivedAt: null, assignment: null });
  });

  it("gives a scoped actor the summary of what it sees", async () => {
    const { h } = await seed();
    const rows = h.orThrow(await h.listEquipment.execute({ actor: actorWith([grant("supervisor", "operation", "op2")]) }));
    expect(rows.map((r) => r.assignment?.operationId)).toEqual(["op2"]);
  });
});
