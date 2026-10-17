import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../../../shared/domain/domain-error";
import { InvalidNameError, NameTakenError } from "../../domain/errors";
import { actorWith, createHarness, grant } from "./support/harness";

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
  it("creates the operation under its unit and audits it with the unit id", async () => {
    const h = createHarness();
    const unit = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Norte" }));
    const op = h.orThrow(await h.createOperation.execute({ actor: h.admin, businessUnitId: unit.id, name: "Mina 1" }));
    expect(op).toMatchObject({ tenantId: "t-a", businessUnitId: unit.id, name: "Mina 1" });
    expect(h.auditOf("organization.operation.create")).toEqual([
      expect.objectContaining({
        entityType: "operation",
        entityId: op.id,
        businessUnitId: unit.id,
        operationId: op.id,
        after: { name: "Mina 1", businessUnitId: unit.id },
      }),
    ]);
  });

  it("lets a business-unit-scoped analyst create under its unit but not under a sibling unit", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "business_unit", s.north.id)]);
    expect((await h.createOperation.execute({ actor, businessUnitId: s.north.id, name: "Mina 3" })).ok).toBe(true);
    const denied = await h.createOperation.execute({ actor, businessUnitId: s.south.id, name: "Mina 4" });
    expect(!denied.ok && denied.error).toBeInstanceOf(ForbiddenError);
  });

  it("denies a viewer and an operation-scoped analyst", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    for (const actor of [tenantActor("viewer"), actorWith([grant("fleet_analyst", "operation", s.mina1.id)])]) {
      const result = await h.createOperation.execute({ actor, businessUnitId: s.north.id, name: "Mina 9" });
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("returns not found for a missing unit and for a unit of another tenant", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    for (const [actor, businessUnitId] of [[h.admin, "missing"], [h.adminB, s.north.id]] as const) {
      const result = await h.createOperation.execute({ actor, businessUnitId, name: "X" });
      expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    }
  });

  it("rejects a duplicate name inside the unit but allows it in another unit", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const dup = await h.createOperation.execute({ actor: h.admin, businessUnitId: s.north.id, name: " MINA 1" });
    expect(!dup.ok && dup.error).toBeInstanceOf(NameTakenError);
    const other = await h.createOperation.execute({ actor: h.admin, businessUnitId: s.south.id, name: "Mina 1" });
    expect(other.ok).toBe(true);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    const unit = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Norte" }));
    h.audit.failNextRecord(new Error("audit down"));
    await expect(
      h.createOperation.execute({ actor: h.admin, businessUnitId: unit.id, name: "Mina 1" }),
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
