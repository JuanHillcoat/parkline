import { describe, expect, it } from "vitest";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import {
  AlreadyArchivedError,
  CostCenterTakenError,
  HasActiveOperationsError,
  HasOpenAssignmentsError,
  NameTakenError,
  NotArchivedError,
  ParentArchivedError,
  ReasonRequiredError,
  ReasonTooLongError,
} from "../../domain/errors";
import { MAX_REASON_LENGTH } from "../reason";
import { actorWith, createHarness, grant, START, type Harness } from "./support/harness";

type Kind = "business_unit" | "site" | "operation";
type Seed = Awaited<ReturnType<Harness["seedTenantA"]>>;
type Input = { actor: Actor; id: string; reason: string };

const KINDS: readonly Kind[] = ["business_unit", "site", "operation"];

const archive = (h: Harness, kind: Kind, input: Input) =>
  ({ business_unit: h.archiveBusinessUnit, site: h.archiveSite, operation: h.archiveOperation })[kind].execute(input);

const restore = (h: Harness, kind: Kind, input: Input) =>
  ({ business_unit: h.restoreBusinessUnit, site: h.restoreSite, operation: h.restoreOperation })[kind].execute(input);

/** One row per kind that can be archived right away: no active operation depends on it. */
const freeRow = async (h: Harness, s: Seed): Promise<Record<Kind, string>> => ({
  business_unit: h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Libre" })).id,
  site: s.lote.id,
  operation: s.mina1.id,
});

const read = (h: Harness, kind: Kind, id: string) =>
  h.store.read((tx) =>
    ({ business_unit: tx.businessUnits, site: tx.sites, operation: tx.operations })[kind].findById("t-a", id),
  );

const iso = START.toISOString();

describe.each(KINDS)("archive and restore of a %s", (kind) => {
  it("archives with a reason, stores archivedAt and audits the previous and new state", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    const result = await archive(h, kind, { actor: h.analyst, id, reason: "  Cargado por error  " });
    expect(result.ok && result.value.archivedAt).toEqual(START);
    expect((await read(h, kind, id))?.archivedAt).toEqual(START);
    expect(h.auditOf("organization.archive").at(-1)).toMatchObject({
      entityType: kind,
      entityId: id,
      actorRole: "fleet_analyst",
      reason: "Cargado por error",
      before: { archivedAt: null },
      after: { archivedAt: iso },
    });
  });

  it("restores with a reason and audits the previous and new state", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    const result = await restore(h, kind, { actor: h.analyst, id, reason: "Era correcto" });
    expect(result.ok && result.value.archivedAt).toBeNull();
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
    expect(h.auditOf("organization.restore").at(-1)).toMatchObject({
      entityType: kind,
      entityId: id,
      reason: "Era correcto",
      before: { archivedAt: iso },
      after: { archivedAt: null },
    });
  });

  it("refuses admin, manager, supervisor and viewer, writing nothing", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    const before = h.audit.entries.length;
    for (const role of ["admin", "manager", "supervisor", "viewer"]) {
      const actor = actorWith([grant(role, "tenant", "t-a")]);
      const result = await archive(h, kind, { actor, id, reason: "Error" });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    expect(h.audit.entries).toHaveLength(before);
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
  });

  it("refuses restore to the roles that cannot archive", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    const result = await restore(h, kind, { actor: h.admin, id, reason: "Volver" });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("refuses an operation-scoped analyst", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const id = (await freeRow(h, s))[kind];
    const actor = actorWith([grant("fleet_analyst", "operation", s.mina1.id)]);
    const result = await archive(h, kind, { actor, id, reason: "Error" });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("refuses an inactive actor before looking the row up", async () => {
    const h = createHarness();
    await h.seedTenantA();
    const actor = { ...h.analyst, active: false };
    const result = await archive(h, kind, { actor, id: "missing", reason: "Error" });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("answers not found for an unknown id and for an id of another tenant", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    const unknown = await archive(h, kind, { actor: h.analyst, id: "missing", reason: "Error" });
    const foreign = await archive(h, kind, { actor: h.analystB, id, reason: "Error" });
    const foreignRestore = await restore(h, kind, { actor: h.analystB, id, reason: "Error" });
    for (const result of [unknown, foreign, foreignRestore]) expect(!result.ok && result.error.code).toBe("not_found");
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
  });

  it("requires a visible reason of at most 500 characters once trimmed", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    for (const reason of ["", "   ", "​ "]) {
      const blank = await archive(h, kind, { actor: h.analyst, id, reason });
      expect(!blank.ok && blank.error).toBeInstanceOf(ReasonRequiredError);
    }
    const long = await archive(h, kind, { actor: h.analyst, id, reason: "r".repeat(MAX_REASON_LENGTH + 1) });
    expect(!long.ok && long.error).toBeInstanceOf(ReasonTooLongError);
    expect(h.auditOf("organization.archive")).toHaveLength(0);
    const exact = await archive(h, kind, { actor: h.analyst, id, reason: ` ${"r".repeat(MAX_REASON_LENGTH)} ` });
    expect(exact.ok).toBe(true);
  });

  it("refuses to archive twice and to restore a row that is not archived", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    const early = await restore(h, kind, { actor: h.analyst, id, reason: "Volver" });
    expect(!early.ok && early.error).toBeInstanceOf(NotArchivedError);
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    const again = await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    expect(!again.ok && again.error).toBeInstanceOf(AlreadyArchivedError);
    expect(h.auditOf("organization.archive")).toHaveLength(1);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    const id = (await freeRow(h, await h.seedTenantA()))[kind];
    h.audit.failNextRecord(new Error("audit down"));
    await expect(archive(h, kind, { actor: h.analyst, id, reason: "Error" })).rejects.toThrow("audit down");
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    h.audit.failNextRecord(new Error("audit down"));
    await expect(restore(h, kind, { actor: h.analyst, id, reason: "Volver" })).rejects.toThrow("audit down");
    expect((await read(h, kind, id))?.archivedAt).toEqual(START);
  });
});

describe("scoped archivers", () => {
  it("lets a division-scoped analyst archive its operations and divisions, but not another division or a site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "business_unit", s.north.id)]);
    expect((await h.archiveOperation.execute({ actor, id: s.mina1.id, reason: "Error" })).ok).toBe(true);
    const other = await h.archiveOperation.execute({ actor, id: s.planta.id, reason: "Error" });
    const site = await h.archiveSite.execute({ actor, id: s.lote.id, reason: "Error" });
    expect(!other.ok && other.error.code).toBe("forbidden");
    expect(!site.ok && site.error.code).toBe("forbidden");
  });

  it("lets a site-scoped analyst archive its site only", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const actor = actorWith([grant("fleet_analyst", "site", s.lote.id)]);
    expect((await h.archiveSite.execute({ actor, id: s.lote.id, reason: "Error" })).ok).toBe(true);
    const denied = await h.archiveSite.execute({ actor, id: s.taller.id, reason: "Error" });
    const operation = await h.archiveOperation.execute({ actor, id: s.mina1.id, reason: "Error" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
    expect(!operation.ok && operation.error.code).toBe("forbidden");
  });
});

describe("blocks while operations are active (D3, D9)", () => {
  it("blocks a division with an active operation until its operations are archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const blocked = await h.archiveBusinessUnit.execute({ actor: h.analyst, id: s.south.id, reason: "Error" });
    expect(!blocked.ok && blocked.error).toBeInstanceOf(HasActiveOperationsError);
    expect(!blocked.ok && blocked.error.code).toBe("has_active_operations");
    expect(h.auditOf("organization.archive")).toHaveLength(0);
    await h.archiveOperation.execute({ actor: h.analyst, id: s.planta.id, reason: "Error" });
    expect((await h.archiveBusinessUnit.execute({ actor: h.analyst, id: s.south.id, reason: "Error" })).ok).toBe(true);
  });

  it("blocks a site with an active operation located at it until the operations are archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const blocked = await h.archiveSite.execute({ actor: h.analyst, id: s.patio.id, reason: "Error" });
    expect(!blocked.ok && blocked.error).toBeInstanceOf(HasActiveOperationsError);
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina2.id, reason: "Error" });
    const stillBlocked = await h.archiveSite.execute({ actor: h.analyst, id: s.patio.id, reason: "Error" });
    expect(!stillBlocked.ok && stillBlocked.error).toBeInstanceOf(HasActiveOperationsError);
    await h.archiveOperation.execute({ actor: h.analyst, id: s.planta.id, reason: "Error" });
    expect((await h.archiveSite.execute({ actor: h.analyst, id: s.patio.id, reason: "Error" })).ok).toBe(true);
  });
});

describe("blocks while an operation has open assignments (D7 of P0-08)", () => {
  it("refuses to archive an operation with open assignments, writing and auditing nothing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.assignments.setOpen("t-a", s.mina1.id, 2);
    const blocked = await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Cierre" });
    expect(!blocked.ok && blocked.error).toBeInstanceOf(HasOpenAssignmentsError);
    expect(!blocked.ok && blocked.error.code).toBe("has_open_assignments");
    expect(h.auditOf("organization.archive")).toHaveLength(0);
    expect((await read(h, "operation", s.mina1.id))?.archivedAt).toBeNull();
  });

  it("archives it once the assignments are ended, and only counts its own assignments", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.assignments.setOpen("t-a", s.mina2.id, 1);
    expect((await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Cierre" })).ok).toBe(true);
    h.assignments.setOpen("t-a", s.mina2.id, 0);
    expect((await h.archiveOperation.execute({ actor: h.analyst, id: s.mina2.id, reason: "Cierre" })).ok).toBe(true);
  });

  it("authorizes before it counts: a refused actor never learns about open assignments", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.assignments.setOpen("t-a", s.mina1.id, 1);
    const result = await h.archiveOperation.execute({ actor: h.admin, id: s.mina1.id, reason: "Cierre" });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("does not block restoring an operation", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Cierre" });
    h.assignments.setOpen("t-a", s.mina1.id, 3);
    expect((await h.restoreOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" })).ok).toBe(true);
  });
});

describe("blocks while a site has open spares (ADR-0013)", () => {
  it("refuses to archive a site with open spares, writing and auditing nothing", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.assignments.setOpenSpares("t-a", s.lote.id, 2);
    const blocked = await h.archiveSite.execute({ actor: h.analyst, id: s.lote.id, reason: "Cierre" });
    expect(!blocked.ok && blocked.error).toBeInstanceOf(HasOpenAssignmentsError);
    expect(!blocked.ok && blocked.error.code).toBe("has_open_assignments");
    expect(h.auditOf("organization.archive")).toHaveLength(0);
    expect((await read(h, "site", s.lote.id))?.archivedAt).toBeNull();
  });

  it("names the active operations first when the site has both active operations and open spares", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.assignments.setOpenSpares("t-a", s.patio.id, 2);
    const blocked = await h.archiveSite.execute({ actor: h.analyst, id: s.patio.id, reason: "Cierre" });
    expect(!blocked.ok && blocked.error.code).toBe("has_active_operations");
    await h.archiveOperation.execute({ actor: h.analyst, id: s.planta.id, reason: "Cierre" });
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina2.id, reason: "Cierre" });
    const stillBlocked = await h.archiveSite.execute({ actor: h.analyst, id: s.patio.id, reason: "Cierre" });
    expect(!stillBlocked.ok && stillBlocked.error.code).toBe("has_open_assignments");
  });

  it("archives it once the spares are ended, and only counts the spares of its own site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const other = h.orThrow(await h.createSite.execute({ actor: h.admin, name: "Other site" }));
    h.assignments.setOpenSpares("t-a", other.id, 1);
    expect((await h.archiveSite.execute({ actor: h.analyst, id: s.lote.id, reason: "Cierre" })).ok).toBe(true);
    h.assignments.setOpenSpares("t-a", other.id, 0);
    expect((await h.archiveSite.execute({ actor: h.analyst, id: other.id, reason: "Cierre" })).ok).toBe(true);
  });

  it("authorizes before it counts and does not block restoring a site", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    h.assignments.setOpenSpares("t-a", s.lote.id, 1);
    const denied = await h.archiveSite.execute({ actor: h.admin, id: s.lote.id, reason: "Cierre" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
    h.assignments.setOpenSpares("t-a", s.lote.id, 0);
    await h.archiveSite.execute({ actor: h.analyst, id: s.lote.id, reason: "Cierre" });
    h.assignments.setOpenSpares("t-a", s.lote.id, 3);
    expect((await h.restoreSite.execute({ actor: h.analyst, id: s.lote.id, reason: "Volver" })).ok).toBe(true);
  });
});

describe("restoring an operation (D4)", () => {
  it("fails with parent_archived while its division or its site is archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const archived = (id: string) => h.archiveOperation.execute({ actor: h.analyst, id, reason: "Error" });
    await archived(s.mina1.id);
    await archived(s.mina2.id);
    await h.archiveBusinessUnit.execute({ actor: h.analyst, id: s.north.id, reason: "Error" });
    const byDivision = await h.restoreOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" });
    expect(!byDivision.ok && byDivision.error).toBeInstanceOf(ParentArchivedError);
    await h.restoreBusinessUnit.execute({ actor: h.analyst, id: s.north.id, reason: "Volver" });
    await h.archiveSite.execute({ actor: h.analyst, id: s.taller.id, reason: "Error" });
    const bySite = await h.restoreOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" });
    expect(!bySite.ok && bySite.error.code).toBe("parent_archived");
    await h.restoreSite.execute({ actor: h.analyst, id: s.taller.id, reason: "Volver" });
    expect((await h.restoreOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" })).ok).toBe(true);
  });
});

describe("names and cost centers are owned by active rows only (D5)", () => {
  it("frees the name and the cost center of an archived operation, then conflicts on restore", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Error" });
    const again = await h.createOperation.execute({
      actor: h.admin, businessUnitId: s.north.id, siteId: s.taller.id, name: "mina 1", costCenter: "0001",
    });
    expect(again.ok).toBe(true);
    const restored = await h.restoreOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" });
    expect(!restored.ok && restored.error).toBeInstanceOf(NameTakenError);
  });

  it("answers cost_center_taken when only the cost center was reused", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Error" });
    h.orThrow(await h.createOperation.execute({
      actor: h.admin, businessUnitId: s.south.id, siteId: s.taller.id, name: "Otra", costCenter: "0001",
    }));
    const restored = await h.restoreOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" });
    expect(!restored.ok && restored.error).toBeInstanceOf(CostCenterTakenError);
    expect(h.auditOf("organization.restore")).toHaveLength(0);
  });

  it("restores when the reused name belongs to another division", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.planta.id, reason: "Error" });
    h.orThrow(await h.createOperation.execute({
      actor: h.admin, businessUnitId: s.north.id, siteId: s.lote.id, name: "Planta", costCenter: "0099",
    }));
    expect((await h.restoreOperation.execute({ actor: h.analyst, id: s.planta.id, reason: "Volver" })).ok).toBe(true);
  });

  it("frees the name of an archived division or site and conflicts on restore", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveSite.execute({ actor: h.analyst, id: s.lote.id, reason: "Error" });
    h.orThrow(await h.createSite.execute({ actor: h.admin, name: "lote" }));
    const site = await h.restoreSite.execute({ actor: h.analyst, id: s.lote.id, reason: "Volver" });
    expect(!site.ok && site.error).toBeInstanceOf(NameTakenError);
    const free = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Libre" }));
    await h.archiveBusinessUnit.execute({ actor: h.analyst, id: free.id, reason: "Error" });
    h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "libre" }));
    const unit = await h.restoreBusinessUnit.execute({ actor: h.analyst, id: free.id, reason: "Volver" });
    expect(!unit.ok && unit.error).toBeInstanceOf(NameTakenError);
  });
});
