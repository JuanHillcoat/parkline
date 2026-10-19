import { describe, expect, it } from "vitest";
import { actorWith, createHarness, grant, START, type Harness } from "./support/harness";

type Seed = Awaited<ReturnType<Harness["seedTenantA"]>>;

/** Archives Mina 1, the site Lote and a division created for the purpose. */
const archiveSome = async (h: Harness, s: Seed) => {
  const free = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Libre" }));
  const input = { actor: h.analyst, reason: "Error" };
  await h.archiveOperation.execute({ ...input, id: s.mina1.id });
  await h.archiveSite.execute({ ...input, id: s.lote.id });
  await h.archiveBusinessUnit.execute({ ...input, id: free.id });
  return free;
};

const names = (rows: readonly { name: string }[]) => rows.map((row) => row.name);

describe("lists hide archived rows by default (D6)", () => {
  it("returns only active rows without the flag, even for an archiver", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archiveSome(h, s);
    const units = h.orThrow(await h.listBusinessUnits.execute({ actor: h.analyst }));
    const operations = h.orThrow(await h.listOperations.execute({ actor: h.analyst }));
    const sites = h.orThrow(await h.listSites.execute({ actor: h.analyst }));
    expect(names(units)).toEqual(["NORTE", "SUR"]);
    expect(names(operations)).toEqual(["MINA 2", "PLANTA"]);
    expect(names(sites)).toEqual(["PATIO", "TALLER"]);
  });

  it("returns archived rows too, with archivedAt, when an archiver asks for them", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archiveSome(h, s);
    const flag = { actor: h.analyst, includeArchived: true };
    const units = h.orThrow(await h.listBusinessUnits.execute(flag));
    const operations = h.orThrow(await h.listOperations.execute(flag));
    const sites = h.orThrow(await h.listSites.execute(flag));
    expect(names(units)).toEqual(["LIBRE", "NORTE", "SUR"]);
    expect(names(operations)).toEqual(["MINA 1", "MINA 2", "PLANTA"]);
    expect(names(sites)).toEqual(["LOTE", "PATIO", "TALLER"]);
    expect(units[0]?.archivedAt).toEqual(START);
    expect(operations[0]?.archivedAt).toEqual(START);
    expect(sites[0]?.archivedAt).toEqual(START);
    expect(operations[1]?.archivedAt).toBeNull();
  });

  it("ignores the flag, without an error, for actors that cannot archive", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archiveSome(h, s);
    const viewer = actorWith([grant("viewer", "tenant", "t-a")]);
    for (const actor of [h.admin, viewer]) {
      const flag = { actor, includeArchived: true };
      expect(names(h.orThrow(await h.listBusinessUnits.execute(flag)))).toEqual(["NORTE", "SUR"]);
      expect(names(h.orThrow(await h.listOperations.execute(flag)))).toEqual(["MINA 2", "PLANTA"]);
      expect(names(h.orThrow(await h.listSites.execute(flag)))).toEqual(["PATIO", "TALLER"]);
    }
  });

  it("honors the flag only for a tenant-wide archiver, so a division-scoped analyst keeps the active view", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await archiveSome(h, s);
    const actor = actorWith([grant("fleet_analyst", "business_unit", s.north.id)]);
    const operations = h.orThrow(await h.listOperations.execute({ actor, includeArchived: true }));
    expect(names(operations)).toEqual(["MINA 2"]);
  });

  it("does not show a site only because an archived operation sits at it", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Error" });
    const actor = actorWith([grant("viewer", "operation", s.mina1.id)]);
    expect(h.orThrow(await h.listSites.execute({ actor }))).toEqual([]);
  });
});
