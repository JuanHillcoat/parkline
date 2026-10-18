import { describe, expect, it } from "vitest";
import type { UnitOfWork } from "../../../shared/domain/ports/unit-of-work";
import { CostCenterTakenError, NameTakenError } from "../../domain/errors";
import type { OrganizationDeps } from "../deps";
import type { OrganizationTx } from "../ports/organization-tx";
import { CreateBusinessUnit } from "../use-cases/create-business-unit";
import { CreateOperation } from "../use-cases/create-operation";
import { CreateSite } from "../use-cases/create-site";
import { RenameBusinessUnit } from "../use-cases/rename-business-unit";
import { RenameOperation } from "../use-cases/rename-operation";
import { RenameSite } from "../use-cases/rename-site";
import { UpdateOperation } from "../use-cases/update-operation";
import { createHarness, type Harness } from "./support/harness";

/** A repository whose name lookup always misses: the pre-check lost a race to a concurrent writer. */
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

describe("the name uniqueness race (D7)", () => {
  it("answers a typed conflict when the unique index rejects a create the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const deps = racingDeps(h);
    const results = [
      await new CreateBusinessUnit(deps).execute({ actor: h.admin, name: " norte " }),
      await new CreateOperation(deps).execute({ actor: h.admin, businessUnitId: s.north.id, siteId: s.lote.id, name: "MINA 1", costCenter: "0077" }),
      await new CreateSite(deps).execute({ actor: h.admin, name: "taller" }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
  });

  it("answers a typed conflict when the unique index rejects a rename the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const deps = racingDeps(h);
    const results = [
      await new RenameBusinessUnit(deps).execute({ actor: h.admin, id: s.south.id, name: "norte" }),
      await new RenameOperation(deps).execute({ actor: h.admin, id: s.mina2.id, name: "mina 1" }),
      await new RenameSite(deps).execute({ actor: h.admin, id: s.lote.id, name: "Patio" }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NameTakenError);
  });

  it("answers cost_center_taken when the unique index rejects a create the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    const result = await new CreateOperation(racingDeps(h)).execute({
      actor: h.admin,
      businessUnitId: s.south.id,
      siteId: s.lote.id,
      name: "Operation S9",
      costCenter: "0001",
    });
    expect(!result.ok && result.error).toBeInstanceOf(CostCenterTakenError);
    expect(!result.ok && result.error.code).toBe("cost_center_taken");
    expect(h.audit.entries).toHaveLength(before);
    expect(await h.store.read((tx) => tx.operations.listByTenant("t-a"))).toHaveLength(3);
  });

  it("answers a typed conflict when the unique index rejects an update the pre-check missed", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const before = h.audit.entries.length;
    const edit = (overrides: object) =>
      new UpdateOperation(racingDeps(h)).execute({
        actor: h.admin,
        operationId: s.mina2.id,
        name: s.mina2.name,
        businessUnitId: s.mina2.businessUnitId,
        siteId: s.mina2.siteId,
        costCenter: s.mina2.costCenter,
        reason: "Race",
        ...overrides,
      });
    const name = await edit({ name: "mina 1" });
    const code = await edit({ costCenter: "0001" });
    expect(!name.ok && name.error).toBeInstanceOf(NameTakenError);
    expect(!code.ok && code.error).toBeInstanceOf(CostCenterTakenError);
    expect(h.audit.entries).toHaveLength(before);
    expect(await h.store.read((tx) => tx.operations.findById("t-a", s.mina2.id))).toEqual(s.mina2);
  });

  it("writes no audit entry and keeps the stored data when the create loses", async () => {
    const h = createHarness();
    await h.seedTenantA();
    const before = h.audit.entries.length;
    await new CreateSite(racingDeps(h)).execute({ actor: h.admin, name: "Taller" });
    expect(h.audit.entries).toHaveLength(before);
    expect(await h.store.read((tx) => tx.sites.listByTenant("t-a"))).toHaveLength(3);
  });
});
