import { describe, expect, it } from "vitest";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import {
  AlreadyArchivedError,
  HasActiveEquipmentError,
  InternalCodeTakenError,
  NameTakenError,
  NotArchivedError,
  ParentArchivedError,
  ReasonRequiredError,
  ReasonTooLongError,
} from "../../domain/errors";
import { MAX_REASON_LENGTH } from "../reason";
import { actorWith, createHarness, grant, START, type Harness } from "./support/harness";

type Kind = "supplier" | "asset_type" | "equipment";
type Input = { actor: Actor; id: string; reason: string };

const KINDS: readonly Kind[] = ["supplier", "asset_type", "equipment"];

const archive = (h: Harness, kind: Kind, input: Input) =>
  ({ supplier: h.archiveSupplier, asset_type: h.archiveAssetType, equipment: h.archiveEquipment })[kind].execute(input);

const restore = (h: Harness, kind: Kind, input: Input) =>
  ({ supplier: h.restoreSupplier, asset_type: h.restoreAssetType, equipment: h.restoreEquipment })[kind].execute(input);

/** One row per kind that can be archived right away: no active equipment depends on it. */
const freeRow = async (h: Harness): Promise<Record<Kind, string>> => {
  const s = await h.seedTenantA();
  return { supplier: s.spare.id, asset_type: s.spareType.id, equipment: s.eq1.id };
};

const read = (h: Harness, kind: Kind, id: string) =>
  h.store.read<{ readonly archivedAt: Date | null } | null>((tx) => ({ supplier: tx.suppliers, asset_type: tx.assetTypes, equipment: tx.equipment })[kind].findById("t-a", id));

const iso = START.toISOString();

describe.each(KINDS)("archive and restore of a %s", (kind) => {
  it("archives with a reason, stores archivedAt and audits the previous and new state", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    const result = await archive(h, kind, { actor: h.analyst, id, reason: "  Cargado por error  " });
    expect(result.ok && result.value.archivedAt).toEqual(START);
    expect((await read(h, kind, id))?.archivedAt).toEqual(START);
    expect(h.auditOf("fleet.archive").at(-1)).toMatchObject({
      entityType: kind, entityId: id, actorRole: "fleet_analyst", reason: "Cargado por error",
      before: { archivedAt: null }, after: { archivedAt: iso },
    });
  });

  it("restores with a reason and audits the previous and new state", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    const result = await restore(h, kind, { actor: h.analyst, id, reason: "Era correcto" });
    expect(result.ok && result.value.archivedAt).toBeNull();
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
    expect(h.auditOf("fleet.restore").at(-1)).toMatchObject({
      entityType: kind, entityId: id, reason: "Era correcto", before: { archivedAt: iso }, after: { archivedAt: null },
    });
  });

  it("refuses admin, manager, supervisor and viewer, writing nothing", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    const before = h.audit.entries.length;
    for (const role of ["admin", "manager", "supervisor", "viewer"]) {
      const actor = actorWith([grant(role, "tenant", "t-a")]);
      const result = await archive(h, kind, { actor, id, reason: "Error" });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
    expect(h.audit.entries).toHaveLength(before);
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
  });

  it("refuses restore to the roles that cannot archive and a division-scoped analyst", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    const scoped = actorWith([grant("fleet_analyst", "business_unit", "bu-1")]);
    for (const actor of [h.admin, scoped]) {
      const result = await restore(h, kind, { actor, id, reason: "Volver" });
      expect(!result.ok && result.error.code).toBe("forbidden");
    }
  });

  it("refuses an inactive actor before looking the row up", async () => {
    const h = createHarness();
    await h.seedTenantA();
    const result = await archive(h, kind, { actor: { ...h.analyst, active: false }, id: "missing", reason: "Error" });
    expect(!result.ok && result.error.code).toBe("forbidden");
  });

  it("answers not found for an unknown id and for an id of another tenant", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    const unknown = await archive(h, kind, { actor: h.analyst, id: "missing", reason: "Error" });
    const foreign = await archive(h, kind, { actor: h.analystB, id, reason: "Error" });
    const foreignRestore = await restore(h, kind, { actor: h.analystB, id, reason: "Error" });
    for (const result of [unknown, foreign, foreignRestore]) expect(!result.ok && result.error.code).toBe("not_found");
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
  });

  it("requires a visible reason of at most 500 characters once trimmed", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    for (const reason of ["", "   ", "​ "]) {
      const blank = await archive(h, kind, { actor: h.analyst, id, reason });
      expect(!blank.ok && blank.error).toBeInstanceOf(ReasonRequiredError);
    }
    const long = await archive(h, kind, { actor: h.analyst, id, reason: "r".repeat(MAX_REASON_LENGTH + 1) });
    expect(!long.ok && long.error).toBeInstanceOf(ReasonTooLongError);
    expect(h.auditOf("fleet.archive")).toHaveLength(0);
    const exact = await archive(h, kind, { actor: h.analyst, id, reason: ` ${"r".repeat(MAX_REASON_LENGTH)} ` });
    expect(exact.ok).toBe(true);
  });

  it("refuses to archive twice and to restore a row that is not archived", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    const early = await restore(h, kind, { actor: h.analyst, id, reason: "Volver" });
    expect(!early.ok && early.error).toBeInstanceOf(NotArchivedError);
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    const again = await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    expect(!again.ok && again.error).toBeInstanceOf(AlreadyArchivedError);
    expect(h.auditOf("fleet.archive")).toHaveLength(1);
  });

  it("rolls back when the audit write fails", async () => {
    const h = createHarness();
    const id = (await freeRow(h))[kind];
    h.audit.failNextRecord(new Error("audit down"));
    await expect(archive(h, kind, { actor: h.analyst, id, reason: "Error" })).rejects.toThrow("audit down");
    expect((await read(h, kind, id))?.archivedAt).toBeNull();
    await archive(h, kind, { actor: h.analyst, id, reason: "Error" });
    h.audit.failNextRecord(new Error("audit down"));
    await expect(restore(h, kind, { actor: h.analyst, id, reason: "Volver" })).rejects.toThrow("audit down");
    expect((await read(h, kind, id))?.archivedAt).toEqual(START);
  });
});

describe("blocks while equipment is active", () => {
  it("blocks a supplier with active equipment until it is archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const blocked = await h.archiveSupplier.execute({ actor: h.analyst, id: s.supplierA.id, reason: "Error" });
    expect(!blocked.ok && blocked.error).toBeInstanceOf(HasActiveEquipmentError);
    expect(!blocked.ok && blocked.error.code).toBe("has_active_equipment");
    expect(h.auditOf("fleet.archive")).toHaveLength(0);
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    expect((await h.archiveSupplier.execute({ actor: h.analyst, id: s.supplierA.id, reason: "Error" })).ok).toBe(true);
  });

  it("blocks an asset type with active equipment until it is archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const blocked = await h.archiveAssetType.execute({ actor: h.analyst, id: s.container.id, reason: "Error" });
    expect(!blocked.ok && blocked.error.code).toBe("has_active_equipment");
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.c43.id, reason: "Error" });
    expect((await h.archiveAssetType.execute({ actor: h.analyst, id: s.container.id, reason: "Error" })).ok).toBe(true);
  });
});

describe("restoring an equipment", () => {
  it("fails with parent_archived while its supplier or asset type is archived", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const input = (id: string, reason = "Error") => ({ actor: h.analyst, id, reason });
    await h.archiveEquipment.execute(input(s.eq1.id));
    await h.archiveSupplier.execute(input(s.supplierA.id));
    const bySupplier = await h.restoreEquipment.execute(input(s.eq1.id, "Volver"));
    expect(!bySupplier.ok && bySupplier.error).toBeInstanceOf(ParentArchivedError);
    await h.restoreSupplier.execute(input(s.supplierA.id, "Volver"));
    await h.archiveAssetType.execute(input(s.forklift.id));
    const byType = await h.restoreEquipment.execute(input(s.eq1.id, "Volver"));
    expect(!byType.ok && byType.error.code).toBe("parent_archived");
    await h.restoreAssetType.execute(input(s.forklift.id, "Volver"));
    expect((await h.restoreEquipment.execute(input(s.eq1.id, "Volver"))).ok).toBe(true);
    expect(h.auditOf("fleet.restore").map((e) => e.entityType)).toEqual(["supplier", "asset_type", "equipment"]);
  });
});

describe("names and internal codes are owned by active rows only", () => {
  it("frees the name of an archived supplier or asset type, then conflicts on restore", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Error" });
    h.orThrow(await h.createSupplier.execute({ actor: h.admin, name: "spare" }));
    const supplier = await h.restoreSupplier.execute({ actor: h.analyst, id: s.spare.id, reason: "Volver" });
    expect(!supplier.ok && supplier.error).toBeInstanceOf(NameTakenError);
    await h.archiveAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Error" });
    h.orThrow(await h.createAssetType.execute({ actor: h.admin, name: "SPARE TYPE", meterKind: "km", preventiveIntervalHours: null }));
    const type = await h.restoreAssetType.execute({ actor: h.analyst, id: s.spareType.id, reason: "Volver" });
    expect(!type.ok && type.error.code).toBe("name_taken");
    expect(h.auditOf("fleet.restore")).toHaveLength(0);
  });

  it("reuses the code of an archived equipment under the same supplier, then conflicts on restore", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "eq-0001")));
    const restored = await h.restoreEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Volver" });
    expect(!restored.ok && restored.error).toBeInstanceOf(InternalCodeTakenError);
    expect(h.auditOf("fleet.restore")).toHaveLength(0);
  });

  it("restores when the same code is only used under another supplier", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    await h.archiveEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Error" });
    h.orThrow(await h.createEquipment.execute(h.equipmentInput(s.supplierB.id, s.forklift.id, "EQ-0001")));
    expect((await h.restoreEquipment.execute({ actor: h.analyst, id: s.eq1.id, reason: "Volver" })).ok).toBe(true);
  });
});
