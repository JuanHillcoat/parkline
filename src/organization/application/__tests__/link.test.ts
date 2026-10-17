import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../../../shared/domain/domain-error";
import { AlreadyLinkedError } from "../../domain/errors";
import { actorWith, createHarness, grant } from "./support/harness";

describe("LinkOperationSite", () => {
  it("links an operation to a site and audits it with the full position", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const link = h.orThrow(await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.lote.id }));
    expect(link).toEqual({ tenantId: "t-a", operationId: s.mina1.id, siteId: s.lote.id });
    expect(h.auditOf("organization.link").at(-1)).toMatchObject({
      entityType: "operation_site",
      entityId: `${s.mina1.id}:${s.lote.id}`,
      businessUnitId: s.north.id,
      operationId: s.mina1.id,
      siteId: s.lote.id,
      after: { operationId: s.mina1.id, siteId: s.lote.id },
    });
  });

  it("reports an existing link as a typed conflict and does not audit again", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.auditOf("organization.link").length;
    const result = await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.taller.id });
    expect(!result.ok && result.error).toBeInstanceOf(AlreadyLinkedError);
    expect(h.auditOf("organization.link")).toHaveLength(before);
  });

  it("returns not found when the operation or the site is missing or belongs to another tenant", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const results = [
      await h.link.execute({ actor: h.admin, operationId: "missing", siteId: s.lote.id }),
      await h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: "missing" }),
      await h.link.execute({ actor: h.adminB, operationId: s.mina1.id, siteId: s.lote.id }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
  });

  it("needs write access over the operation: a viewer, a site-scoped and a sibling-scoped analyst are denied", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actors = [
      actorWith([grant("viewer", "tenant", "t-a")]),
      actorWith([grant("fleet_analyst", "site", s.lote.id)]),
      actorWith([grant("fleet_analyst", "operation", s.mina2.id)]),
    ];
    for (const actor of actors) {
      const result = await h.link.execute({ actor, operationId: s.mina1.id, siteId: s.lote.id });
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
  });

  it("lets an operation-scoped analyst link its own operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "operation", s.mina1.id)]);
    expect((await h.link.execute({ actor, operationId: s.mina1.id, siteId: s.lote.id })).ok).toBe(true);
  });

  it("rolls the link back when the audit write fails", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(
      h.link.execute({ actor: h.admin, operationId: s.mina1.id, siteId: s.lote.id }),
    ).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.links.find("t-a", s.mina1.id, s.lote.id))).toBeNull();
  });
});
