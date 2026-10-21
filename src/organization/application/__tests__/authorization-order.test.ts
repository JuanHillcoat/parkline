import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

type Seed = Awaited<ReturnType<Harness["seedTenantA"]>>;

const UNKNOWN = "id-that-does-not-exist";

/** What a call answered, reduced to what a caller could observe. */
const answerOf = (result: { ok: true } | { ok: false; error: DomainError }) =>
  result.ok ? "ok" : `${result.error.code}: ${result.error.message}`;

/** One use case called twice, with a row that exists and with an id that does not. */
type Probe = { readonly name: string; readonly call: (h: Harness, s: Seed, actor: Harness["admin"], exists: boolean) => Promise<{ ok: true } | { ok: false; error: DomainError }> };

const probes: readonly Probe[] = [
  { name: "rename a division", call: (h, s, actor, exists) => h.renameBusinessUnit.execute({ actor, id: exists ? s.north.id : UNKNOWN, name: "Nuevo" }) },
  { name: "rename an operation", call: (h, s, actor, exists) => h.renameOperation.execute({ actor, id: exists ? s.mina1.id : UNKNOWN, name: "Nuevo" }) },
  { name: "rename a site", call: (h, s, actor, exists) => h.renameSite.execute({ actor, id: exists ? s.taller.id : UNKNOWN, name: "Nuevo" }) },
  { name: "archive a division", call: (h, s, actor, exists) => h.archiveBusinessUnit.execute({ actor, id: exists ? s.north.id : UNKNOWN, reason: "motivo" }) },
  { name: "archive an operation", call: (h, s, actor, exists) => h.archiveOperation.execute({ actor, id: exists ? s.mina1.id : UNKNOWN, reason: "motivo" }) },
  { name: "archive a site", call: (h, s, actor, exists) => h.archiveSite.execute({ actor, id: exists ? s.lote.id : UNKNOWN, reason: "motivo" }) },
  { name: "restore a division", call: (h, s, actor, exists) => h.restoreBusinessUnit.execute({ actor, id: exists ? s.north.id : UNKNOWN, reason: "motivo" }) },
  { name: "restore an operation", call: (h, s, actor, exists) => h.restoreOperation.execute({ actor, id: exists ? s.mina1.id : UNKNOWN, reason: "motivo" }) },
  { name: "restore a site", call: (h, s, actor, exists) => h.restoreSite.execute({ actor, id: exists ? s.lote.id : UNKNOWN, reason: "motivo" }) },
  {
    name: "edit an operation",
    call: (h, s, actor, exists) =>
      h.updateOperation.execute({
        actor,
        operationId: exists ? s.mina1.id : UNKNOWN,
        name: "Nuevo",
        businessUnitId: s.north.id,
        siteId: s.taller.id,
        costCenter: "0001",
        reason: "motivo",
      }),
  },
  {
    name: "create an operation",
    call: (h, s, actor, exists) =>
      h.createOperation.execute({
        actor,
        businessUnitId: exists ? s.north.id : UNKNOWN,
        siteId: s.lote.id,
        name: "Nueva",
        costCenter: "0099",
      }),
  },
];

describe("a missing row answers like a row outside the actor's reach", () => {
  describe.each(probes)("$name", ({ call }) => {
    it("gives an actor with no grants the same answer for an existing id and an unknown one", async () => {
      const h = createHarness();
      const s = await h.seedTenantA();
      const nobody = actorWith([]);
      const known = answerOf(await call(h, s, nobody, true));
      const unknown = answerOf(await call(h, s, nobody, false));
      expect(known).toMatch(/^forbidden/);
      expect(unknown).toBe(known);
    });

    it("gives a division-scoped actor the same answer for an unknown id as for a row it cannot reach", async () => {
      const h = createHarness();
      const s = await h.seedTenantA();
      const southOnly = actorWith([grant("fleet_analyst", "business_unit", s.south.id), grant("manager", "business_unit", s.south.id)]);
      const unknown = answerOf(await call(h, s, southOnly, false));
      expect(unknown).toMatch(/^forbidden/);
    });
  });

  it("still tells a tenant-wide writer that an id does not exist", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const renamed = await h.renameBusinessUnit.execute({ actor: h.admin, id: UNKNOWN, name: "Nuevo" });
    expect(!renamed.ok && renamed.error).toBeInstanceOf(NotFoundError);
    const archived = await h.archiveSite.execute({ actor: h.analyst, id: UNKNOWN, reason: "motivo" });
    expect(!archived.ok && archived.error).toBeInstanceOf(NotFoundError);
    const edited = await h.updateOperation.execute({
      actor: h.admin,
      operationId: UNKNOWN,
      name: "Nuevo",
      businessUnitId: s.north.id,
      siteId: s.taller.id,
      costCenter: "0001",
      reason: "motivo",
    });
    expect(!edited.ok && edited.error).toBeInstanceOf(NotFoundError);
  });

  it("does not let a division manager probe whether a target division exists when moving an operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const manager = actorWith([grant("manager", "business_unit", s.north.id)]);
    const move = (businessUnitId: string) =>
      h.updateOperation.execute({
        actor: manager,
        operationId: s.mina1.id,
        name: "Mina 1",
        businessUnitId,
        siteId: s.taller.id,
        costCenter: "0001",
        reason: "motivo",
      });
    const toExisting = await move(s.south.id);
    const toUnknown = await move(UNKNOWN);
    expect(!toExisting.ok && toExisting.error).toBeInstanceOf(ForbiddenError);
    expect(answerOf(toUnknown)).toBe(answerOf(toExisting));
  });

  it("answers the same way for an actor of another tenant (the row is invisible to it)", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const known = await h.renameSite.execute({ actor: h.adminB, id: s.taller.id, name: "Nuevo" });
    const unknown = await h.renameSite.execute({ actor: h.adminB, id: UNKNOWN, name: "Nuevo" });
    // Both are "not found": the row is invisible to another tenant. The message names the id asked about
    // (it is never shown to a user), so the code is what is compared.
    expect(!unknown.ok && unknown.error.code).toBe("not_found");
    expect(!known.ok && known.error.code).toBe("not_found");
  });
});
