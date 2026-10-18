import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../../../shared/domain/domain-error";
import { InvalidNameError, NameTakenError } from "../../domain/errors";
import { actorWith, createHarness, grant } from "./support/harness";

describe("rename use cases", () => {
  it("renames a business unit and audits before and after", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const renamed = h.orThrow(await h.renameBusinessUnit.execute({ actor: h.admin, id: s.north.id, name: " Norte Grande " }));
    expect(renamed).toEqual({ ...s.north, name: "NORTE GRANDE" });
    expect(h.auditOf("organization.rename").at(-1)).toMatchObject({
      entityType: "business_unit",
      entityId: s.north.id,
      businessUnitId: s.north.id,
      actorRole: "admin",
      before: { name: "NORTE" },
      after: { name: "NORTE GRANDE" },
    });
  });

  it("renames an operation and a site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.orThrow(await h.renameOperation.execute({ actor: h.admin, id: s.mina1.id, name: "Mina Uno" }));
    h.orThrow(await h.renameSite.execute({ actor: h.admin, id: s.taller.id, name: "Taller Central" }));
    const entries = h.auditOf("organization.rename");
    expect(entries.map((e) => e.entityType)).toEqual(["operation", "site"]);
    expect(entries[0]).toMatchObject({ operationId: s.mina1.id, businessUnitId: s.north.id });
    expect(entries[1]).toMatchObject({ siteId: s.taller.id, after: { name: "TALLER CENTRAL" } });
  });

  it("rejects renaming into an accent or case variant of a sibling name", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.orThrow(await h.renameSite.execute({ actor: h.admin, id: s.taller.id, name: "Bahía Blanca" }));
    const clash = await h.renameSite.execute({ actor: h.admin, id: s.lote.id, name: "bahia blanca" });
    expect(!clash.ok && clash.error.code).toBe("name_taken");
    const own = await h.renameSite.execute({ actor: h.admin, id: s.taller.id, name: "BAHIA BLANCA" });
    expect(own.ok && own.value.name).toBe("BAHIA BLANCA");
  });

  it("stores a lowercase rename uppercase and allows re-saving the same name", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.renameSite.execute({ actor: h.admin, id: s.taller.id, name: "taller" });
    expect(result.ok && result.value.name).toBe("TALLER");
  });

  it("rejects a name already used under the same owner and allows it under another", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const unit = await h.renameBusinessUnit.execute({ actor: h.admin, id: s.south.id, name: "norte" });
    const op = await h.renameOperation.execute({ actor: h.admin, id: s.mina2.id, name: "mina 1" });
    const site = await h.renameSite.execute({ actor: h.admin, id: s.lote.id, name: "Patio" });
    for (const result of [unit, op, site]) expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
    expect((await h.renameOperation.execute({ actor: h.admin, id: s.planta.id, name: "Mina 1" })).ok).toBe(true);
  });

  it("rejects an invalid name", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.renameSite.execute({ actor: h.admin, id: s.taller.id, name: "" });
    expect(!result.ok && result.error).toBeInstanceOf(InvalidNameError);
  });

  it("returns not found for a missing entity and for another tenant's entity", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const results = [
      await h.renameBusinessUnit.execute({ actor: h.admin, id: "missing", name: "X" }),
      await h.renameOperation.execute({ actor: h.adminB, id: s.mina1.id, name: "X" }),
      await h.renameSite.execute({ actor: h.adminB, id: s.taller.id, name: "X" }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
  });

  it("denies a viewer and a sibling-scoped analyst", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    const sibling = actorWith([grant("fleet_analyst", "operation", s.mina2.id)]);
    const results = [
      await h.renameBusinessUnit.execute({ actor: viewer, id: s.north.id, name: "X" }),
      await h.renameOperation.execute({ actor: sibling, id: s.mina1.id, name: "X" }),
      await h.renameSite.execute({ actor: sibling, id: s.taller.id, name: "X" }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
  });

  it("lets an operation-scoped analyst rename its own operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "operation", s.mina1.id)]);
    expect((await h.renameOperation.execute({ actor, id: s.mina1.id, name: "Mina Uno" })).ok).toBe(true);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.renameOperation.execute({ actor: h.admin, id: s.mina1.id, name: "Otra" })).rejects.toThrow("audit down");
    const stored = await h.store.read((tx) => tx.operations.findById("t-a", s.mina1.id));
    expect(stored?.name).toBe("MINA 1");
  });
});
