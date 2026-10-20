import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? "ok" : result.error?.code);

/** The ids a refused actor must not be able to tell apart: missing, another tenant's, and archived parents. */
const probeIds = async (h: Harness) => {
  const s = await h.seedTenantA();
  await h.archiveSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
  await h.archiveAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
  await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Error" });
  return { s, ids: ["missing", s.supplierA.id, s.spare.id, s.eq1.id, s.c43.id, s.spareType.id] };
};

const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
const viewerB = actorWith([grant("viewer", "tenant", "t-b")], { tenantId: "t-b" });
const archiveRefused = [
  actorWith([grant("admin", "tenant", "t-a")]),
  actorWith([grant("manager", "tenant", "t-a")]),
  actorWith([grant("admin", "tenant", "t-b")], { tenantId: "t-b" }),
];

describe("writers are authorized before any lookup that reveals existence", () => {
  it.each([viewer, viewerB])("answers forbidden to a viewer for every id", async (actor) => {
    const h = createHarness();
    const { s, ids } = await probeIds(h);
    for (const id of ids) {
      expect(code(await h.renameSupplier.execute({ actor, id, name: "Other" }))).toBe("forbidden");
      expect(
        code(await h.updateAssetType.execute({ actor, id, name: "Other", meterKind: "km", preventiveIntervalHours: null, reason: "Why" })),
      ).toBe("forbidden");
      const fields = h.equipmentInput(s.supplierA.id, s.forklift.id, "X-1", { actor });
      expect(code(await h.updateEquipment.execute({ ...fields, id, reason: "Why" }))).toBe("forbidden");
      expect(code(await h.createEquipment.execute(h.equipmentInput(id, s.forklift.id, "X-1", { actor })))).toBe("forbidden");
      expect(code(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, id, "X-1", { actor })))).toBe("forbidden");
    }
    expect(code(await h.createSupplier.execute({ actor, name: "New" }))).toBe("forbidden");
    expect(code(await h.createAssetType.execute({ actor, name: "New", meterKind: "km", preventiveIntervalHours: null }))).toBe("forbidden");
  });

  it.each(archiveRefused)("answers forbidden to a role without catalog.archive for archive and restore", async (actor) => {
    const h = createHarness();
    const { ids } = await probeIds(h);
    for (const id of ids) {
      for (const use of [h.archiveSupplier, h.archiveAssetType, h.archiveEquipment, h.restoreSupplier, h.restoreAssetType, h.restoreEquipment]) {
        expect(code(await use.execute({ actor, id, reason: "Why" }))).toBe("forbidden");
      }
    }
  });

  it("keeps the typed errors for an authorized actor", async () => {
    const h = createHarness();
    const { ids } = await probeIds(h);
    expect(ids).toContain("missing");
    const result = await h.renameSupplier.execute({ actor: h.admin, id: "missing", name: "Other" });
    expect(code(result)).toBe("not_found");
  });
});
