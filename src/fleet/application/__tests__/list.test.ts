import { describe, expect, it } from "vitest";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

type Lists = Pick<Harness, "listSuppliers" | "listAssetTypes" | "listEquipment">;
type Kind = keyof Lists;

const KINDS: readonly Kind[] = ["listSuppliers", "listAssetTypes", "listEquipment"];

const list = async (h: Harness, kind: Kind, actor: Actor, includeArchived?: boolean): Promise<readonly unknown[]> => {
  const result = await h[kind].execute({ actor, includeArchived });
  if (!result.ok) throw result.error;
  return result.value;
};

describe("the fleet lists", () => {
  it.each(KINDS)("%s returns the active rows of the tenant for every tenant-wide role", async (kind) => {
    const h = createHarness();
    await h.seedTenantA();
    const counts = { listSuppliers: 3, listAssetTypes: 3, listEquipment: 2 };
    for (const role of ["admin", "fleet_analyst", "manager", "supervisor", "viewer"]) {
      const actor = actorWith([grant(role, "tenant", "t-a")]);
      expect(await list(h, kind, actor)).toHaveLength(counts[kind]);
    }
  });

  it.each(KINDS)("%s is empty for scoped readers and never shows another tenant", async (kind) => {
    const h = createHarness();
    await h.seedTenantA();
    const scoped = [
      actorWith([grant("viewer", "business_unit", "bu-1")]),
      actorWith([grant("viewer", "operation", "op-1")]),
      actorWith([grant("viewer", "site", "site-1")]),
    ];
    for (const actor of scoped) expect(await list(h, kind, actor)).toEqual([]);
    expect(await list(h, kind, h.adminB)).toEqual([]);
  });

  it.each(KINDS)("%s refuses an inactive actor", async (kind) => {
    const h = createHarness();
    const result = await h[kind].execute({ actor: { ...h.admin, active: false } });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("orders suppliers and asset types by name key and equipment by internal code", async () => {
    const h = createHarness();
    await h.createSupplier.execute({ actor: h.admin, name: "Zeta" });
    await h.createSupplier.execute({ actor: h.admin, name: "Álamo" });
    await h.createSupplier.execute({ actor: h.admin, name: "Beta" });
    const suppliers = h.orThrow(await h.listSuppliers.execute({ actor: h.admin }));
    expect(suppliers.map((row) => row.name)).toEqual(["ÁLAMO", "BETA", "ZETA"]);
    const s = await h.seedTenantA();
    await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "A-1"));
    const codes = h.orThrow(await h.listEquipment.execute({ actor: h.admin })).map((row) => row.internalCode);
    expect(codes).toEqual(["A-1", "C-043", "EQ-0001"]);
  });

  it.each(KINDS)("%s shows archived rows only to archivers who ask for them", async (kind) => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    await h.archiveSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
    await h.archiveAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
    const active = { listSuppliers: 2, listAssetTypes: 2, listEquipment: 1 };
    const all = { listSuppliers: 3, listAssetTypes: 3, listEquipment: 2 };
    expect(await list(h, kind, h.analyst)).toHaveLength(active[kind]);
    expect(await list(h, kind, h.analyst, true)).toHaveLength(all[kind]);
    expect(await list(h, kind, h.admin, true)).toHaveLength(active[kind]);
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    expect(await list(h, kind, viewer, true)).toHaveLength(active[kind]);
  });
});
