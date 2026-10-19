import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../shared/domain/ports/unit-of-work";
import { CostCenterTakenError, NameTakenError } from "../../domain/errors";
import type { OrganizationDeps } from "../deps";
import type { OrganizationTx } from "../ports/organization-tx";
import { ArchiveOperation } from "../use-cases/archive-operation";
import { ArchiveSite } from "../use-cases/archive-site";
import { RestoreBusinessUnit } from "../use-cases/restore-business-unit";
import { RestoreOperation } from "../use-cases/restore-operation";
import { RestoreSite } from "../use-cases/restore-site";
import { createHarness, type Harness } from "./support/harness";

/** Name and cost center lookups always miss: the pre-check lost a race to a concurrent writer. */
const blind = <T extends object>(repository: T): T =>
  Object.assign(Object.create(repository) as T, {
    findByName: () => Promise.resolve(null),
    findByCostCenter: () => Promise.resolve(null),
  });

const racingDeps = (h: Harness): OrganizationDeps => {
  const unitOfWork: UnitOfWork<OrganizationTx> = {
    run: (work) =>
      h.deps.unitOfWork.run((tx) =>
        work({ ...tx, businessUnits: blind(tx.businessUnits), operations: blind(tx.operations), sites: blind(tx.sites) }),
      ),
  };
  return { ...h.deps, unitOfWork };
};

describe("the restore uniqueness race (D5)", () => {
  it("answers a typed conflict when the partial index rejects a restore the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const input = { actor: h.analyst, reason: "Error" };
    await h.archiveSite.execute({ ...input, id: s.lote.id });
    h.orThrow(await h.createSite.execute({ actor: h.admin, name: "Lote" }));
    await h.archiveOperation.execute({ ...input, id: s.mina1.id });
    h.orThrow(await h.createOperation.execute({
      actor: h.admin, businessUnitId: s.north.id, siteId: s.taller.id, name: "Mina 1", costCenter: "0042",
    }));
    const free = h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Libre" }));
    await h.archiveBusinessUnit.execute({ ...input, id: free.id });
    h.orThrow(await h.createBusinessUnit.execute({ actor: h.admin, name: "Libre" }));
    const before = h.audit.entries.length;
    const deps = racingDeps(h);
    const restore = { actor: h.analyst, reason: "Volver" };
    const results = [
      await new RestoreSite(deps).execute({ ...restore, id: s.lote.id }),
      await new RestoreOperation(deps).execute({ ...restore, id: s.mina1.id }),
      await new RestoreBusinessUnit(deps).execute({ ...restore, id: free.id }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
    expect(h.audit.entries).toHaveLength(before);
  });

  it("answers cost_center_taken when only the cost center index rejects the restore", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Error" });
    h.orThrow(await h.createOperation.execute({
      actor: h.admin, businessUnitId: s.south.id, siteId: s.taller.id, name: "Otra", costCenter: "0001",
    }));
    const before = h.audit.entries.length;
    const result = await new RestoreOperation(racingDeps(h)).execute({ actor: h.analyst, id: s.mina1.id, reason: "Volver" });
    expect(!result.ok && result.error).toBeInstanceOf(CostCenterTakenError);
    expect(h.audit.entries).toHaveLength(before);
    expect((await h.store.read((tx) => tx.operations.findById("t-a", s.mina1.id)))?.archivedAt).not.toBeNull();
  });
});

/** The write finds the row already in the requested state: a concurrent request changed it first. */
const staleWrites = <T extends object>(repository: T): T =>
  Object.assign(Object.create(repository) as T, { setArchivedAt: () => Promise.resolve("state_changed") });

describe("the archive state race", () => {
  const stale = (h: Harness): OrganizationDeps => {
    const unitOfWork: UnitOfWork<OrganizationTx> = {
      run: (work) =>
        h.deps.unitOfWork.run((tx) =>
          work({ ...tx, businessUnits: staleWrites(tx.businessUnits), operations: staleWrites(tx.operations), sites: staleWrites(tx.sites) }),
        ),
    };
    return { ...h.deps, unitOfWork };
  };

  it("answers already_archived / not_archived when the write lost the race, without an audit entry", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveOperation.execute({ actor: h.analyst, id: s.mina1.id, reason: "Error" });
    const before = h.audit.entries.length;
    const deps = stale(h);
    const archive = { actor: h.analyst, reason: "Otra vez" };
    const results = [
      await new ArchiveSite(deps).execute({ ...archive, id: s.lote.id }),
      await new ArchiveOperation(deps).execute({ ...archive, id: s.mina2.id }),
      await new RestoreOperation(deps).execute({ ...archive, id: s.mina1.id }),
      await new RestoreBusinessUnit(deps).execute({ ...archive, id: s.north.id }),
    ];
    expect(results.map((r) => (r.ok ? "ok" : r.error.code))).toEqual([
      "already_archived", "already_archived", "not_archived", "not_archived",
    ]);
    expect(h.audit.entries).toHaveLength(before);
  });
});
