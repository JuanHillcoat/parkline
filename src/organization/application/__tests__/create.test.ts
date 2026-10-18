import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../../../shared/domain/domain-error";
import { CostCenterTakenError, InvalidCostCenterError, InvalidNameError, NameTakenError } from "../../domain/errors";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const tenantActor = (role: string) => actorWith([grant(role, "tenant", "t-a")]);

describe("CreateBusinessUnit", () => {
  it("creates the unit and audits it in the same unit of work", async () => {
    const h = createHarness();
    const unit = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "  Norte " }));
    expect(unit).toEqual({ id: "id-1", tenantId: "t-a", name: "Norte" });
    expect(await h.store.read((tx) => tx.businessUnits.listByTenant("t-a"))).toEqual([unit]);
    expect(h.auditOf("organization.business_unit.create")).toEqual([
      expect.objectContaining({
        actorId: "user-1",
        actorRole: "admin",
        entityType: "business_unit",
        entityId: unit.id,
        tenantId: "t-a",
        businessUnitId: unit.id,
        after: { name: "Norte" },
      }),
    ]);
  });

  it("lets a tenant-scoped fleet analyst create and records its role", async () => {
    const h = createHarness();
    const result = await h.createBusinessUnit.execute({ actor: tenantActor("fleet_analyst"), name: "Norte" });
    expect(result.ok).toBe(true);
    expect(h.audit.entries[0]?.actorRole).toBe("fleet_analyst");
  });

  it("denies a viewer, an operation-scoped analyst, another tenant's admin and an inactive admin", async () => {
    const h = createHarness();
    const actors = [
      tenantActor("viewer"),
      actorWith([grant("fleet_analyst", "operation", "op-1")]),
      actorWith([grant("admin", "tenant", "t-a")], { tenantId: "t-b" }),
      actorWith([grant("admin", "tenant", "t-a")], { active: false }),
    ];
    for (const actor of actors) {
      const result = await h.createBusinessUnit.execute({ actor, name: "Norte" });
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
    expect(h.audit.entries).toHaveLength(0);
  });

  it("rejects an invalid name without writing", async () => {
    const h = createHarness();
    const result = await h.createBusinessUnit.execute({ actor: h.admin, name: "  " });
    expect(!result.ok && result.error).toBeInstanceOf(InvalidNameError);
    expect(h.audit.entries).toHaveLength(0);
  });

  it("rejects a duplicate name per tenant, ignoring case, outer and inner spaces", async () => {
    const h = createHarness();
    await h.createBusinessUnit.execute({ actor: h.admin, name: "Zona Norte" });
    const result = await h.createBusinessUnit.execute({ actor: h.admin, name: " zona   NORTE " });
    expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
    expect(!result.ok && result.error.code).toBe("name_taken");
    expect(h.auditOf("organization.business_unit.create")).toHaveLength(1);
  });

  it("allows the same name in another tenant", async () => {
    const h = createHarness();
    await h.createBusinessUnit.execute({ actor: h.admin, name: "Norte" });
    expect((await h.createBusinessUnit.execute({ actor: h.adminB, name: "Norte" })).ok).toBe(true);
  });

  it("rolls the unit back when the audit write fails", async () => {
    const h = createHarness();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.createBusinessUnit.execute({ actor: h.admin, name: "Norte" })).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.businessUnits.listByTenant("t-a"))).toEqual([]);
  });
});

describe("CreateOperation", () => {
  const base = (s: Awaited<ReturnType<Harness["seedTenantA"]>>) => ({
    businessUnitId: s.north.id,
    siteId: s.lote.id,
    name: "Mina 9",
    costCenter: "0009",
  });

  it("creates the operation under its division at its site and audits cost center and site", async () => {
    const h = createHarness();
    const unit = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Norte" }));
    const site = h.orThrow(await h.createSite.execute({ actor: h.admin, name: "Taller" }));
    const input = { actor: h.admin, businessUnitId: unit.id, siteId: site.id, name: " Mina 1 ", costCenter: " 0050 " };
    const op = h.orThrow(await h.createOperation.execute(input));
    expect(op).toMatchObject({
      tenantId: "t-a",
      businessUnitId: unit.id,
      siteId: site.id,
      name: "Mina 1",
      costCenter: "0050",
    });
    expect(h.auditOf("organization.operation.create")).toEqual([
      expect.objectContaining({
        entityType: "operation",
        entityId: op.id,
        businessUnitId: unit.id,
        operationId: op.id,
        siteId: site.id,
        after: { name: "Mina 1", businessUnitId: unit.id, siteId: site.id, costCenter: "0050" },
      }),
    ]);
  });

  it("lets a division-scoped analyst create under its division but not under another one", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "business_unit", s.north.id)]);
    expect((await h.createOperation.execute({ actor, ...base(s) })).ok).toBe(true);
    const denied = await h.createOperation.execute({
      actor,
      ...base(s),
      businessUnitId: s.south.id,
      name: "Mina 10",
      costCenter: "0010",
    });
    expect(!denied.ok && denied.error).toBeInstanceOf(ForbiddenError);
  });

  it("denies a viewer, an operation-scoped analyst and a site-scoped analyst (a site write is not enough)", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actors = [
      tenantActor("viewer"),
      actorWith([grant("fleet_analyst", "operation", s.mina1.id)]),
      actorWith([grant("fleet_analyst", "site", s.lote.id)]),
    ];
    for (const actor of actors) {
      const result = await h.createOperation.execute({ actor, ...base(s) });
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
    expect(h.auditOf("organization.operation.create")).toHaveLength(3);
  });

  it("returns not found for a missing division or site and for ids of another tenant", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const siteB = h.orThrow(await h.createSite.execute({ actor: h.adminB, name: "Taller" }));
    const unitB = h.orThrow(await h.createBusinessUnit.execute({ actor: h.adminB, name: "Norte" }));
    const attempts = [
      { actor: h.admin, ...base(s), businessUnitId: "missing" },
      { actor: h.admin, ...base(s), siteId: "missing" },
      { actor: h.adminB, ...base(s), siteId: siteB.id },
      { actor: h.adminB, ...base(s), businessUnitId: unitB.id },
      { actor: h.admin, ...base(s), siteId: siteB.id },
      { actor: h.admin, ...base(s), businessUnitId: unitB.id },
    ];
    for (const input of attempts) {
      const result = await h.createOperation.execute(input);
      expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    }
  });

  it("rejects an invalid cost center without writing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    for (const costCenter of ["50", "00500", "abcd", "00 50", ""]) {
      const result = await h.createOperation.execute({ actor: h.admin, ...base(s), costCenter });
      expect(!result.ok && result.error).toBeInstanceOf(InvalidCostCenterError);
    }
    expect(h.audit.entries).toHaveLength(before);
  });

  it("rejects a duplicate name inside the division but allows it in another division", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const dup = await h.createOperation.execute({ actor: h.admin, ...base(s), name: " MINA 1" });
    expect(!dup.ok && dup.error).toBeInstanceOf(NameTakenError);
    const other = await h.createOperation.execute({ actor: h.admin, ...base(s), businessUnitId: s.south.id, name: "Mina 1" });
    expect(other.ok).toBe(true);
  });

  it("rejects a cost center already used in the tenant, even in another division and site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const dup = await h.createOperation.execute({
      actor: h.admin,
      ...base(s),
      businessUnitId: s.south.id,
      siteId: s.taller.id,
      costCenter: " 0001 ",
    });
    expect(!dup.ok && dup.error).toBeInstanceOf(CostCenterTakenError);
    expect(!dup.ok && dup.error.code).toBe("cost_center_taken");
  });

  it("lets two tenants reuse the same cost center", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const unitB = h.orThrow(await h.createBusinessUnit.execute({ actor: h.adminB, name: "Norte" }));
    const siteB = h.orThrow(await h.createSite.execute({ actor: h.adminB, name: "Taller" }));
    const result = await h.createOperation.execute({
      actor: h.adminB,
      businessUnitId: unitB.id,
      siteId: siteB.id,
      name: "Mina 1",
      costCenter: s.mina1.costCenter,
    });
    expect(result.ok).toBe(true);
  });

  it("lets two operations share a site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const result = await h.createOperation.execute({ actor: h.admin, ...base(s), siteId: s.patio.id });
    expect(result.ok).toBe(true);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    const unit = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Norte" }));
    const site = h.orThrow(await h.createSite.execute({ actor: h.admin, name: "Taller" }));
    h.audit.failNextRecord(new Error("audit down"));
    await expect(
      h.createOperation.execute({ actor: h.admin, businessUnitId: unit.id, siteId: site.id, name: "Mina 1", costCenter: "0050" }),
    ).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.operations.listByTenant("t-a"))).toEqual([]);
  });
});
describe("CreateSite", () => {
  it("creates the site and audits it", async () => {
    const h = createHarness();
    const site = h.orThrow(await h.createSite.execute({ actor: tenantActor("fleet_analyst"), name: "Taller" }));
    expect(site).toEqual({ id: "id-1", tenantId: "t-a", name: "Taller" });
    expect(h.auditOf("organization.site.create")).toEqual([
      expect.objectContaining({ entityType: "site", entityId: site.id, siteId: site.id, after: { name: "Taller" } }),
    ]);
  });

  it("denies a viewer and a site-scoped analyst", async () => {
    const h = createHarness();
    for (const actor of [tenantActor("viewer"), actorWith([grant("fleet_analyst", "site", "s-1")])]) {
      const result = await h.createSite.execute({ actor, name: "Taller" });
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("rejects a duplicate name per tenant", async () => {
    const h = createHarness();
    await h.createSite.execute({ actor: h.admin, name: "Taller" });
    const result = await h.createSite.execute({ actor: h.admin, name: "taller " });
    expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.createSite.execute({ actor: h.admin, name: "Taller" })).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.sites.listByTenant("t-a"))).toEqual([]);
  });
});
