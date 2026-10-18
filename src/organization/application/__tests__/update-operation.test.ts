import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError } from "../../../shared/domain/domain-error";
import type { Operation } from "../../domain/entities";
import {
  CostCenterTakenError,
  InvalidCostCenterError,
  InvalidNameError,
  NameTakenError,
  NoChangesError,
  ReasonRequiredError,
} from "../../domain/errors";
import type { UpdateOperationInput } from "../use-cases/update-operation";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

type Seed = Awaited<ReturnType<Harness["seedTenantA"]>>;

/** The complete desired values: the form sends every field, prefilled with the current ones. */
const editOf = (h: Harness, current: Operation, overrides: Partial<UpdateOperationInput> = {}): UpdateOperationInput => ({
  actor: h.admin,
  operationId: current.id,
  name: current.name,
  businessUnitId: current.businessUnitId,
  siteId: current.siteId,
  costCenter: current.costCenter,
  reason: "Correccion contable",
  ...overrides,
});

const setup = async () => {
  const h = createHarness();
  const s: Seed = await h.seedTenantA();
  const stored = (id: string) => h.store.read((tx) => tx.operations.findById("t-a", id));
  return { h, s, stored };
};

describe("UpdateOperation: changes and audit", () => {
  it("changes every field at once and audits before, after and the reason", async () => {
    const { h, s, stored } = await setup();
    const result = await h.updateOperation.execute(
      editOf(h, s.mina1, { name: " mina uno ", businessUnitId: s.south.id, siteId: s.lote.id, costCenter: " 0099 ", reason: "  Se muda de division  " }),
    );
    const expected = { ...s.mina1, name: "MINA UNO", businessUnitId: s.south.id, siteId: s.lote.id, costCenter: "0099" };
    expect(result.ok && result.value).toEqual(expected);
    expect(await stored(s.mina1.id)).toEqual(expected);
    const entries = h.auditOf("organization.operation.update");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entityType: "operation",
      entityId: s.mina1.id,
      businessUnitId: s.south.id,
      operationId: s.mina1.id,
      siteId: s.lote.id,
      actorRole: "admin",
      reason: "Se muda de division",
      before: { name: "MINA 1", businessUnitId: s.north.id, siteId: s.taller.id, costCenter: "0001" },
      after: { name: "MINA UNO", businessUnitId: s.south.id, siteId: s.lote.id, costCenter: "0099" },
    });
  });

  type Change = readonly [input: Partial<UpdateOperationInput>, stored: Partial<Operation>];
  const changes: readonly (readonly [string, (s: Seed) => Change])[] = [
    ["name", () => [{ name: "Mina Nueva" }, { name: "MINA NUEVA" }]],
    ["division", (s) => [{ businessUnitId: s.south.id }, { businessUnitId: s.south.id }]],
    ["site", (s) => [{ siteId: s.lote.id }, { siteId: s.lote.id }]],
    ["cost center", () => [{ costCenter: "0042" }, { costCenter: "0042" }]],
  ];

  it.each(changes)("changes the %s alone", async (_label, change) => {
    const { h, s, stored } = await setup();
    const [input, expected] = change(s);
    const result = await h.updateOperation.execute(editOf(h, s.mina1, input));
    expect(result.ok).toBe(true);
    expect(await stored(s.mina1.id)).toMatchObject(expected);
    const entry = h.auditOf("organization.operation.update").at(-1);
    expect(entry?.before).toMatchObject({ name: "MINA 1", businessUnitId: s.north.id, siteId: s.taller.id, costCenter: "0001" });
    expect(entry?.after).toMatchObject(expected);
  });

  it("applies the uppercase normalization and lets the operation keep its own name and cost center", async () => {
    const { h, s } = await setup();
    const result = await h.updateOperation.execute(editOf(h, s.mina1, { name: "mina 1", siteId: s.lote.id }));
    expect(result.ok && result.value.name).toBe("MINA 1");
  });

  it("returns no_changes without writing or auditing when every value is the current one", async () => {
    const { h, s } = await setup();
    const before = h.audit.entries.length;
    const result = await h.updateOperation.execute(editOf(h, s.mina1, { name: " mina  1 ", costCenter: "0001 " }));
    expect(!result.ok && result.error).toBeInstanceOf(NoChangesError);
    expect(!result.ok && result.error.code).toBe("no_changes");
    expect(h.audit.entries).toHaveLength(before);
  });
});

describe("UpdateOperation: validation", () => {
  const invisible = String.fromCharCode(0x200b, 0x00a0, 0xfeff);
  it.each([["empty", ""], ["blank", "   \t "], ["invisible only", invisible]])(
    "requires a reason (%s)",
    async (_label, reason) => {
      const { h, s, stored } = await setup();
      const result = await h.updateOperation.execute(editOf(h, s.mina1, { name: "Otro", reason }));
      expect(!result.ok && result.error).toBeInstanceOf(ReasonRequiredError);
      expect(!result.ok && result.error.code).toBe("reason_required");
      expect((await stored(s.mina1.id))?.name).toBe("MINA 1");
      expect(h.auditOf("organization.operation.update")).toHaveLength(0);
    },
  );

  it("rejects an invalid name and an invalid cost center", async () => {
    const { h, s } = await setup();
    const name = await h.updateOperation.execute(editOf(h, s.mina1, { name: "  " }));
    const code = await h.updateOperation.execute(editOf(h, s.mina1, { costCenter: "12" }));
    expect(!name.ok && name.error).toBeInstanceOf(InvalidNameError);
    expect(!code.ok && code.error).toBeInstanceOf(InvalidCostCenterError);
  });

  it("returns not found for a missing operation, a missing division, a missing site and another tenant's ids", async () => {
    const { h, s } = await setup();
    const results = [
      await h.updateOperation.execute(editOf(h, s.mina1, { operationId: "missing" })),
      await h.updateOperation.execute(editOf(h, s.mina1, { businessUnitId: "missing" })),
      await h.updateOperation.execute(editOf(h, s.mina1, { siteId: "missing" })),
      await h.updateOperation.execute(editOf(h, s.mina1, { actor: h.adminB })),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    const other = h.orThrow(await h.createBusinessUnit.execute({ actor: h.adminB, name: "Norte" }));
    const foreign = await h.updateOperation.execute(editOf(h, s.mina1, { businessUnitId: other.id }));
    expect(!foreign.ok && foreign.error).toBeInstanceOf(NotFoundError);
  });
});

describe("UpdateOperation: conflicts", () => {
  it("rejects a name already used in the target division, case and accent insensitive", async () => {
    const { h, s } = await setup();
    const sameDivision = await h.updateOperation.execute(editOf(h, s.mina2, { name: "mina 1" }));
    expect(!sameDivision.ok && sameDivision.error).toBeInstanceOf(NameTakenError);
    const moved = await h.updateOperation.execute(editOf(h, s.planta, { name: "MINA 1", businessUnitId: s.north.id }));
    expect(!moved.ok && moved.error).toBeInstanceOf(NameTakenError);
    expect(h.auditOf("organization.operation.update")).toHaveLength(0);
  });

  it("allows the same name in another division", async () => {
    const { h, s } = await setup();
    const result = await h.updateOperation.execute(editOf(h, s.planta, { name: "Mina 1" }));
    expect(result.ok).toBe(true);
  });

  it("rejects a cost center used by another operation of the tenant", async () => {
    const { h, s } = await setup();
    const result = await h.updateOperation.execute(editOf(h, s.mina2, { costCenter: "0001" }));
    expect(!result.ok && result.error).toBeInstanceOf(CostCenterTakenError);
    expect(!result.ok && result.error.code).toBe("cost_center_taken");
  });
});

describe("UpdateOperation: authorization", () => {
  it("lets a division-scoped analyst edit and move within its division", async () => {
    const { h, s } = await setup();
    const actor = actorWith([grant("fleet_analyst", "business_unit", s.north.id)]);
    const result = await h.updateOperation.execute(editOf(h, s.mina1, { actor, name: "Mina Norte", siteId: s.lote.id }));
    expect(result.ok).toBe(true);
    expect(h.auditOf("organization.operation.update").at(-1)).toMatchObject({ actorRole: "fleet_analyst" });
  });

  it("refuses a division-scoped analyst moving an operation out of its scope or into another division", async () => {
    const { h, s } = await setup();
    const north = actorWith([grant("fleet_analyst", "business_unit", s.north.id)]);
    const out = await h.updateOperation.execute(editOf(h, s.mina1, { actor: north, businessUnitId: s.south.id }));
    const intoOther = await h.updateOperation.execute(editOf(h, s.planta, { actor: north, businessUnitId: s.north.id, name: "Planta Norte" }));
    for (const result of [out, intoOther]) expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    expect((await h.store.read((tx) => tx.operations.findById("t-a", s.mina1.id)))?.businessUnitId).toBe(s.north.id);
  });

  it("refuses operation-scoped, site-scoped and viewer actors, even for a rename-like edit", async () => {
    const { h, s } = await setup();
    const actors = [
      actorWith([grant("fleet_analyst", "operation", s.mina1.id)]),
      actorWith([grant("fleet_analyst", "site", s.taller.id)]),
      actorWith([grant("viewer", "tenant", "t-a")]),
    ];
    for (const actor of actors) {
      const result = await h.updateOperation.execute(editOf(h, s.mina1, { actor, name: "Otro" }));
      expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
    }
    expect(h.auditOf("organization.operation.update")).toHaveLength(0);
  });

  it("refuses an inactive actor first", async () => {
    const { h, s } = await setup();
    const actor = actorWith([grant("admin", "tenant", "t-a")], { active: false });
    const result = await h.updateOperation.execute(editOf(h, s.mina1, { actor, operationId: "missing" }));
    expect(!result.ok && result.error).toBeInstanceOf(ForbiddenError);
  });
});

describe("UpdateOperation: atomicity", () => {
  it("rolls the change back when the audit write fails", async () => {
    const { h, s, stored } = await setup();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.updateOperation.execute(editOf(h, s.mina1, { name: "Otra", costCenter: "0050" }))).rejects.toThrow("audit down");
    expect(await stored(s.mina1.id)).toEqual(s.mina1);
  });
});
