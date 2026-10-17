import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const names = (items: readonly { name: string }[]): string[] => items.map((item) => item.name);

const listAs = async (h: Harness, actor: Actor) => ({
  units: names(h.orThrow(await h.listBusinessUnits.execute({ actor }))),
  operations: names(h.orThrow(await h.listOperations.execute({ actor }))),
  sites: names(h.orThrow(await h.listSites.execute({ actor }))),
});

describe("list use cases (visibility, D4)", () => {
  it("tenant scope sees everything of its tenant, sorted by name", async () => {
    const h = createHarness();
    await h.seedTenantA();
    expect(await listAs(h, h.admin)).toEqual({
      units: ["Norte", "Sur"],
      operations: ["Mina 1", "Mina 2", "Planta"],
      sites: ["Lote", "Patio", "Taller"],
    });
  });

  it("business unit scope sees its operations and the sites linked to them, not the other unit", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("viewer", "business_unit", s.north.id)]);
    expect(await listAs(h, actor)).toEqual({
      units: ["Norte"],
      operations: ["Mina 1", "Mina 2"],
      sites: ["Patio", "Taller"],
    });
  });

  it("operation scope sees only itself and its sites, not its sibling, its unit or unrelated sites", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("viewer", "operation", s.mina1.id)]);
    expect(await listAs(h, actor)).toEqual({ units: [], operations: ["Mina 1"], sites: ["Taller"] });
  });

  it("site scope sees the site and every operation linked to it, across units", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("viewer", "site", s.patio.id)]);
    expect(await listAs(h, actor)).toEqual({ units: [], operations: ["Mina 2", "Planta"], sites: ["Patio"] });
  });

  it("a link made later widens what an operation scope sees", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.lote.id });
    const actor = actorWith([grant("viewer", "operation", s.mina1.id)]);
    expect((await listAs(h, actor)).sites).toEqual(["Lote", "Taller"]);
  });

  it("never shows another tenant's rows, even to a tenant-scoped admin or with a foreign scope id", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.createBusinessUnit.execute({ actor: h.adminB, name: "Beta" });
    await h.createSite.execute({ actor: h.adminB, name: "Depósito" });
    expect(await listAs(h, h.adminB)).toEqual({ units: ["Beta"], operations: [], sites: ["Depósito"] });
    const foreign = actorWith([grant("viewer", "operation", s.mina1.id)], { tenantId: "t-b" });
    expect(await listAs(h, foreign)).toEqual({ units: [], operations: [], sites: [] });
  });

  it("an actor without grants sees nothing and an inactive actor is forbidden", async () => {
    const h = createHarness();
    await h.seedTenantA();
    expect(await listAs(h, actorWith([]))).toEqual({ units: [], operations: [], sites: [] });
    const inactive = actorWith([grant("admin", "tenant", "t-a")], { active: false });
    for (const result of [
      await h.listBusinessUnits.execute({ actor: inactive }),
      await h.listOperations.execute({ actor: inactive }),
      await h.listSites.execute({ actor: inactive }),
    ]) {
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("reads write no audit entry", async () => {
    const h = createHarness();
    await h.seedTenantA();
    const before = h.audit.entries.length;
    await listAs(h, h.admin);
    expect(h.audit.entries).toHaveLength(before);
  });
});
