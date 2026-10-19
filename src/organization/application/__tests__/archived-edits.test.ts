import { describe, expect, it } from "vitest";
import { ArchivedError, NameTakenError, ParentArchivedError } from "../../domain/errors";
import { createHarness, type Harness } from "./support/harness";

type Seed = Awaited<ReturnType<Harness["seedTenantA"]>>;

const archived = async (h: Harness, s: Seed) => {
  const reason = "Error";
  const archive = { actor: h.analyst, reason };
  await h.archiveOperation.execute({ ...archive, id: s.mina1.id });
  await h.archiveOperation.execute({ ...archive, id: s.mina2.id });
  await h.archiveBusinessUnit.execute({ ...archive, id: s.north.id });
  await h.archiveSite.execute({ ...archive, id: s.lote.id });
  await h.archiveSite.execute({ ...archive, id: s.taller.id });
};

const editOf = (h: Harness, current: Seed["mina1"], overrides: object) => ({
  actor: h.admin,
  operationId: current.id,
  name: current.name,
  businessUnitId: current.businessUnitId,
  siteId: current.siteId,
  costCenter: current.costCenter,
  reason: "Cambio",
  ...overrides,
});

describe("edits of an archived row are refused (D7)", () => {
  it("refuses to rename an archived division, operation or site with a typed archived error", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    const results = [
      await h.renameBusinessUnit.execute({ actor: h.admin, id: s.north.id, name: "Otro" }),
      await h.renameOperation.execute({ actor: h.admin, id: s.mina1.id, name: "Otra" }),
      await h.renameSite.execute({ actor: h.admin, id: s.lote.id, name: "Otro" }),
    ];
    for (const result of results) {
      expect(!result.ok && result.error).toBeInstanceOf(ArchivedError);
      expect(!result.ok && result.error.code).toBe("archived");
    }
    expect(h.auditOf("organization.rename")).toHaveLength(0);
  });

  it("refuses to update an archived operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    const result = await h.updateOperation.execute(editOf(h, s.mina2, { name: "Otra" }));
    expect(!result.ok && result.error).toBeInstanceOf(ArchivedError);
    expect(h.auditOf("organization.operation.update")).toHaveLength(0);
  });

  it("still lets the writer edit an active row", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    expect((await h.renameOperation.execute({ actor: h.admin, id: s.planta.id, name: "Planta 2" })).ok).toBe(true);
  });
});

describe("archived parents (D4)", () => {
  it("refuses to create an operation in an archived division or at an archived site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    const base = { actor: h.admin, name: "Nueva", costCenter: "0050" };
    const division = await h.createOperation.execute({ ...base, businessUnitId: s.north.id, siteId: s.patio.id });
    const site = await h.createOperation.execute({ ...base, businessUnitId: s.south.id, siteId: s.lote.id });
    for (const result of [division, site]) {
      expect(!result.ok && result.error).toBeInstanceOf(ParentArchivedError);
      expect(!result.ok && result.error.code).toBe("parent_archived");
    }
  });

  it("refuses to move an operation to an archived division or site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    const division = await h.updateOperation.execute(editOf(h, s.planta, { businessUnitId: s.north.id }));
    const site = await h.updateOperation.execute(editOf(h, s.planta, { siteId: s.lote.id }));
    for (const result of [division, site]) expect(!result.ok && result.error).toBeInstanceOf(ParentArchivedError);
    expect(h.auditOf("organization.operation.update")).toHaveLength(0);
  });
});

describe("only active rows own a name or a cost center (D5)", () => {
  it("lets a new division, site or operation reuse the name and cost center of an archived one", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    const unit = await h.createBusinessUnit.execute({ actor: h.admin, name: "norte" });
    const site = await h.createSite.execute({ actor: h.admin, name: "lote" });
    const operation = await h.createOperation.execute({
      actor: h.admin, businessUnitId: s.south.id, siteId: s.patio.id, name: "Mina 1", costCenter: "0001",
    });
    expect([unit.ok, site.ok, operation.ok]).toEqual([true, true, true]);
  });

  it("lets a rename and an update take the name or cost center of an archived operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    expect((await h.renameOperation.execute({ actor: h.admin, id: s.planta.id, name: "Mina 1" })).ok).toBe(true);
    const moved = await h.updateOperation.execute(editOf(h, s.planta, { name: "Planta", costCenter: "0001" }));
    expect(moved.ok).toBe(true);
  });

  it("still refuses the name of an active row", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archived(h, s);
    const result = await h.renameSite.execute({ actor: h.admin, id: s.patio.id, name: "taller" });
    expect(result.ok).toBe(true);
    const again = await h.createSite.execute({ actor: h.admin, name: "Taller" });
    expect(!again.ok && again.error).toBeInstanceOf(NameTakenError);
  });
});
