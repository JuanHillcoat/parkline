import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant } from "./support/harness";

/**
 * A scoped reader cannot read the suppliers and asset types lists (they stay tenant-wide), so each
 * visible equipment carries the names of its own supplier and asset type.
 */
describe("ListEquipment carries the supplier and asset type names", () => {
  it("gives a scoped reader the names of its visible equipment, not the lists", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.assign(s.eq1.id, "op1", "2026-01-10");
    const supervisor = actorWith([grant("supervisor", "operation", "op1")]);

    const rows = h.orThrow(await h.listEquipment.execute({ actor: supervisor }));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.supplier).toEqual({ id: s.supplierA.id, name: "SUPPLIER A" });
    expect(rows[0]?.assetType).toEqual({ id: s.forklift.id, name: "FORKLIFT", meterKind: "hours", preventiveIntervalHours: 250 });
  });

  it("gives tenant-wide readers the names of every equipment, assigned or not", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const rows = h.orThrow(await h.listEquipment.execute({ actor: h.admin }));
    const byCode = new Map(rows.map((row) => [row.internalCode, row]));
    expect(byCode.get("C-043")?.supplier.name).toBe("SUPPLIER B");
    expect(byCode.get("C-043")?.assetType).toEqual({ id: s.container.id, name: "CONTAINER", meterKind: "none", preventiveIntervalHours: null });
  });

  it("keeps the names of an archived supplier's archived equipment for the reader that sees it", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Baja" });
    await h.archiveSupplier.execute({ actor: h.analyst, id: s.supplierB.id, reason: "Cierre" });
    const rows = h.orThrow(await h.listEquipment.execute({ actor: h.analyst, includeArchived: true }));
    expect(rows.find((row) => row.internalCode === "C-043")?.supplier.name).toBe("SUPPLIER B");
  });
});
