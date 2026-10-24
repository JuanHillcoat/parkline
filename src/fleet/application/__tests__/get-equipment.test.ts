import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant } from "./support/harness";

/**
 * One equipment by id, under the same visibility rule as the list (D6): a tenant-wide reader sees any
 * equipment of the tenant (archived and unassigned included); a scoped reader only the equipment whose
 * OPEN assignment sits inside its scope. A missing id and an id the actor cannot see answer identically.
 * Fake organization: op1 = division bu1 / site s1, op2 = bu1 / s2, op3 = bu2 / s3.
 */
const seed = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const idle = h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-0009")));
  await h.assign(s.eq1.id, "op1", "2026-01-10");
  await h.assign(s.c43.id, "op3", "2026-03-01", { kind: "spare" });
  return { h, s, idle };
};

const NOT_FOUND = "not_found";

describe("GetEquipment", () => {
  it("returns the equipment with its supplier, asset type and current assignment", async () => {
    const { h, s } = await seed();
    const item = h.orThrow(await h.getEquipment.execute({ actor: h.analyst, id: s.eq1.id }));
    expect(item).toMatchObject({
      id: s.eq1.id,
      internalCode: "EQ-0001",
      supplier: { id: s.supplierA.id, name: "SUPPLIER A" },
      assetType: { id: s.forklift.id, name: "FORKLIFT", meterKind: "hours" },
      assignment: { operationId: "op1", siteId: "s1", businessUnitId: "bu1", kind: "active", validFrom: "2026-01-10" },
    });
  });

  it("returns an unassigned equipment to a tenant-wide reader with no assignment", async () => {
    const { h, idle } = await seed();
    for (const role of ["admin", "fleet_analyst", "manager", "supervisor", "viewer"]) {
      const item = h.orThrow(await h.getEquipment.execute({ actor: actorWith([grant(role, "tenant", "t-a")]), id: idle.id }));
      expect(item.assignment).toBeNull();
    }
  });

  it("returns an archived equipment to a tenant-wide reader", async () => {
    const { h, idle } = await seed();
    h.orThrow(await h.archiveEquipment.execute({ actor: h.analyst, id: idle.id, reason: "Error" }));
    const item = h.orThrow(await h.getEquipment.execute({ actor: actorWith([grant("viewer", "tenant", "t-a")]), id: idle.id }));
    expect(item.archivedAt).not.toBeNull();
  });

  it("shows a scoped reader the equipment placed in its scope", async () => {
    const { h, s } = await seed();
    for (const actor of [
      actorWith([grant("manager", "business_unit", "bu1")]),
      actorWith([grant("supervisor", "operation", "op1")]),
      actorWith([grant("viewer", "site", "s1")]),
    ]) {
      const item = h.orThrow(await h.getEquipment.execute({ actor, id: s.eq1.id }));
      expect(item.internalCode).toBe("EQ-0001");
      expect(item.supplier.name).toBe("SUPPLIER A");
    }
  });

  it("answers not found for a scoped reader outside the scope, an unassigned or an archived equipment", async () => {
    const { h, s, idle } = await seed();
    const supervisor = actorWith([grant("supervisor", "operation", "op1")]);
    const outside = await h.getEquipment.execute({ actor: supervisor, id: s.c43.id });
    const unassigned = await h.getEquipment.execute({ actor: supervisor, id: idle.id });
    h.orThrow(await h.archiveEquipment.execute({ actor: h.analyst, id: idle.id, reason: "Error" }));
    const archived = await h.getEquipment.execute({ actor: supervisor, id: idle.id });
    for (const result of [outside, unassigned, archived]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(NOT_FOUND);
    }
  });

  it("answers a missing id exactly like an id the actor cannot see", async () => {
    const { h, s } = await seed();
    const supervisor = actorWith([grant("supervisor", "operation", "op1")]);
    const invisible = await h.getEquipment.execute({ actor: supervisor, id: s.c43.id });
    const missing = await h.getEquipment.execute({ actor: supervisor, id: "does-not-exist" });
    if (invisible.ok || missing.ok) throw new Error("both must fail");
    expect(invisible.error.code).toBe(missing.error.code);
    expect(invisible.error.constructor).toBe(missing.error.constructor);
    const wide = await h.getEquipment.execute({ actor: h.analyst, id: "does-not-exist" });
    if (wide.ok) throw new Error("must fail");
    expect(wide.error.code).toBe(NOT_FOUND);
  });

  it("never returns the equipment of another tenant", async () => {
    const { h, s } = await seed();
    const result = await h.getEquipment.execute({ actor: h.adminB, id: s.eq1.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(NOT_FOUND);
  });

  it("refuses an inactive actor before looking anything up", async () => {
    const { h, s } = await seed();
    const result = await h.getEquipment.execute({ actor: { ...h.admin, active: false }, id: s.eq1.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("forbidden");
  });
});
