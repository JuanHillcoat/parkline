import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import type { AuditLog } from "../../src/shared/domain/ports/audit-log";
import type { Result } from "../../src/shared/domain/result";
import { createPostgresFleetTx } from "../../src/fleet/infrastructure/postgres-fleet-tx";
import { PostgresOperationDirectory } from "../../src/organization/infrastructure/postgres-operation-directory";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });

let admin: Sql;
let owner: Sql;
let app: Sql;
let c: Container;
let adminActor: Actor;
let analyst: Actor;
let manager: Actor;
let viewer: Actor;

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  owner = postgres(url.toString(), { max: 2, onnotice: () => undefined });
  await migrate(owner, MIGRATIONS_DIR);
  // Every connection of the application runs as the restricted role.
  app = postgres(url.toString(), { max: 6, onnotice: () => undefined, connection: { role: "parkline_app" } });
  c = createContainer(app, { hasher });
  const credentials = { email: "admin@example.test", password: PASSWORD };
  must(await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials }));
  adminActor = await signInActor(credentials.email);
  analyst = await staff("analyst@example.test", "fleet_analyst");
  manager = await staff("manager@example.test", "manager");
  viewer = await staff("viewer@example.test", "viewer");
});

afterAll(async () => {
  await app.end();
  await owner.end();
  await admin.unsafe(`drop database if exists ${dbName}`);
  await admin.end();
});

function must<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected error result: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function signInActor(email: string): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email, password: PASSWORD }));
  return toActor(must(await c.identity.authenticate.execute({ token: signed.token })));
}

async function staff(email: string, role: Role): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role }));
  return signInActor(email);
}

const f = () => c.fleet;
const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const names = (rows: readonly { name: string }[]): string[] => rows.map((row) => row.name);
const asAnalyst = (reason: string) => ({ actor: analyst, reason });

const equipmentFields = (supplierId: string, assetTypeId: string, internalCode: string) => ({
  supplierId,
  assetTypeId,
  internalCode,
  brand: null,
  model: null,
  year: null,
  serialNumber: null,
  batteryQuantity: null,
  observations: null,
});

const addSupplier = async (name: string) => must(await f().createSupplier.execute({ actor: adminActor, name }));
const addType = async (name: string) =>
  must(await f().createAssetType.execute({ actor: adminActor, name, meterKind: "hours", preventiveIntervalHours: 250 }));
const addEquipment = async (supplierId: string, assetTypeId: string, internalCode: string) =>
  must(await f().createEquipment.execute({ actor: adminActor, ...equipmentFields(supplierId, assetTypeId, internalCode) }));

let counter = 0;
/** A supplier, an asset type and one equipment of their own, with names that never collide. */
async function fixture(label: string) {
  const n = String((counter += 1));
  const supplier = await addSupplier(`${label} Supplier ${n}`);
  const type = await addType(`${label} Type ${n}`);
  const equipment = await addEquipment(supplier.id, type.id, `EQ-${n}`);
  return { supplier, type, equipment };
}

type AuditRow = { action: string; entity_type: string; reason: string | null; role: string; before: unknown; after: unknown };
const audits = (entityId: string) =>
  owner<AuditRow[]>`
    select action, entity_type, reason, role, before, after from audit_log where entity_id = ${entityId} order by id`;

describe("fleet through the container as parkline_app", () => {
  it("starts empty, then creates a supplier, an asset type and an equipment with their audit entries", async () => {
    const empty = await owner`select (select count(*) from suppliers) as s, (select count(*) from asset_types) as t, (select count(*) from equipments) as e`;
    expect(Number(empty[0]?.s) + Number(empty[0]?.t) + Number(empty[0]?.e)).toBe(0);
    const supplier = await addSupplier("  Supplier   A ");
    expect(supplier.name).toBe("SUPPLIER A");
    const type = await addType("Forklift");
    const equipment = must(
      await f().createEquipment.execute({
        actor: analyst,
        ...equipmentFields(supplier.id, type.id, " eq-0001 "),
        brand: "Brand X",
        year: 2020,
        batteryQuantity: 2,
      }),
    );
    expect(equipment.internalCode).toBe("EQ-0001");
    expect(names(must(await f().listSuppliers.execute({ actor: viewer })))).toEqual(["SUPPLIER A"]);
    expect(must(await f().listEquipment.execute({ actor: viewer })).map((e) => e.internalCode)).toEqual(["EQ-0001"]);
    expect((await audits(supplier.id))[0]).toMatchObject({ action: "fleet.supplier.create", role: "admin", after: { name: "SUPPLIER A" } });
    expect((await audits(equipment.id))[0]).toMatchObject({ action: "fleet.equipment.create", entity_type: "equipment" });
  });

  it("refuses a viewer on every write and a manager on archive, answering forbidden for any id", async () => {
    const fx = await fixture("Refused");
    const missing = "00000000-0000-4000-8000-000000000000";
    for (const id of [fx.supplier.id, missing, "not-a-uuid"]) {
      expect(code(await f().renameSupplier.execute({ actor: viewer, id, name: "Other" }))).toBe("forbidden");
      expect(code(await f().archiveSupplier.execute({ actor: manager, id, reason: "Baja" }))).toBe("forbidden");
      expect(code(await f().archiveEquipment.execute({ actor: adminActor, id, reason: "Baja" }))).toBe("forbidden");
    }
    expect(code(await f().createSupplier.execute({ actor: viewer, name: "New" }))).toBe("forbidden");
    expect(code(await f().renameSupplier.execute({ actor: adminActor, id: "not-a-uuid", name: "Other" }))).toBe("not_found");
    expect(await audits(fx.supplier.id)).toHaveLength(1);
  });

  it("edits an asset type and an equipment with a reason and records before and after", async () => {
    const fx = await fixture("Edit");
    const type = must(
      await f().updateAssetType.execute({
        actor: adminActor, id: fx.type.id, name: fx.type.name, meterKind: "km", preventiveIntervalHours: 500, reason: "  Cambio de medidor ",
      }),
    );
    expect([type.meterKind, type.preventiveIntervalHours]).toEqual(["km", 500]);
    const other = await addSupplier(`Edit Other ${String(counter)}`);
    const moved = must(
      await f().updateEquipment.execute({
        actor: analyst, id: fx.equipment.id, ...equipmentFields(other.id, fx.type.id, "EQ-MOVED"), brand: "Brand Y", reason: "Cambio de proveedor",
      }),
    );
    expect([moved.supplierId, moved.internalCode, moved.brand]).toEqual([other.id, "EQ-MOVED", "Brand Y"]);
    const [typeEntry] = (await audits(fx.type.id)).slice(-1);
    expect(typeEntry).toMatchObject({
      action: "fleet.asset_type.update", reason: "Cambio de medidor",
      before: { meterKind: "hours", preventiveIntervalHours: 250 }, after: { meterKind: "km", preventiveIntervalHours: 500 },
    });
    const [equipmentEntry] = (await audits(fx.equipment.id)).slice(-1);
    expect(equipmentEntry).toMatchObject({ action: "fleet.equipment.update", reason: "Cambio de proveedor", role: "fleet_analyst" });
    expect(JSON.stringify(equipmentEntry?.before)).toContain(fx.supplier.name);
    expect(JSON.stringify(equipmentEntry?.after)).toContain(other.name);
    expect(code(await f().updateAssetType.execute({ actor: adminActor, id: fx.type.id, name: type.name, meterKind: "km", preventiveIntervalHours: 500, reason: "Igual" }))).toBe("no_changes");
    expect(code(await f().updateAssetType.execute({ actor: adminActor, id: fx.type.id, name: "New", meterKind: "km", preventiveIntervalHours: 500, reason: "   " }))).toBe("reason_required");
  });

  it("blocks archiving a supplier or type with active equipment, then archives bottom-up and restores top-down", async () => {
    const fx = await fixture("Chain");
    expect(code(await f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: fx.supplier.id }))).toBe("has_active_equipment");
    expect(code(await f().archiveAssetType.execute({ ...asAnalyst("Baja"), id: fx.type.id }))).toBe("has_active_equipment");
    must(await f().archiveEquipment.execute({ ...asAnalyst("  Baja por error "), id: fx.equipment.id }));
    must(await f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: fx.supplier.id }));
    must(await f().archiveAssetType.execute({ ...asAnalyst("Baja"), id: fx.type.id }));
    expect(names(must(await f().listSuppliers.execute({ actor: analyst })))).not.toContain(fx.supplier.name);
    expect(names(must(await f().listSuppliers.execute({ actor: analyst, includeArchived: true })))).toContain(fx.supplier.name);
    expect(names(must(await f().listSuppliers.execute({ actor: adminActor, includeArchived: true })))).not.toContain(fx.supplier.name);
    expect(code(await f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id }))).toBe("parent_archived");
    must(await f().restoreSupplier.execute({ ...asAnalyst("Volver"), id: fx.supplier.id }));
    expect(code(await f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id }))).toBe("parent_archived");
    must(await f().restoreAssetType.execute({ ...asAnalyst("Volver"), id: fx.type.id }));
    must(await f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id }));
    const entries = await audits(fx.equipment.id);
    expect(entries.map((e) => e.action)).toEqual(["fleet.equipment.create", "fleet.archive", "fleet.restore"]);
    expect(entries[1]).toMatchObject({ reason: "Baja por error", role: "fleet_analyst", before: { archivedAt: null } });
    expect(entries[2]).toMatchObject({ reason: "Volver", after: { archivedAt: null } });
  });

  it("frees names and internal codes on archive and answers typed conflicts on restore", async () => {
    const fx = await fixture("Reuse");
    must(await f().archiveEquipment.execute({ ...asAnalyst("Baja"), id: fx.equipment.id }));
    const twin = await addEquipment(fx.supplier.id, fx.type.id, fx.equipment.internalCode.toLowerCase());
    expect(code(await f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id }))).toBe("internal_code_taken");
    const second = await addSupplier(`Reuse Second ${String(counter)}`);
    await addEquipment(second.id, fx.type.id, fx.equipment.internalCode);
    must(await f().archiveEquipment.execute({ ...asAnalyst("Baja"), id: twin.id }));
    must(await f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id }));
    must(await f().archiveEquipment.execute({ ...asAnalyst("Baja"), id: fx.equipment.id }));
    must(await f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: fx.supplier.id }));
  });

  it("answers name_taken when restoring a supplier or an asset type whose name an active row took, writing nothing", async () => {
    const fx = await fixture("NameRestore");
    must(await f().archiveEquipment.execute({ ...asAnalyst("Baja"), id: fx.equipment.id }));
    must(await f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: fx.supplier.id }));
    must(await f().archiveAssetType.execute({ ...asAnalyst("Baja"), id: fx.type.id }));
    await addSupplier(fx.supplier.name.toLowerCase());
    await addType(fx.type.name.toLowerCase());
    expect(code(await f().restoreSupplier.execute({ ...asAnalyst("Volver"), id: fx.supplier.id }))).toBe("name_taken");
    expect(code(await f().restoreAssetType.execute({ ...asAnalyst("Volver"), id: fx.type.id }))).toBe("name_taken");
    for (const [table, id] of [["suppliers", fx.supplier.id], ["asset_types", fx.type.id]] as const) {
      const rows = await owner.unsafe(`select archived_at from ${table} where id = '${id}'`);
      expect(rows[0]?.archived_at).not.toBeNull();
      expect((await audits(id)).map((e) => e.action)).toEqual([expect.stringMatching(/create$/), "fleet.archive"]);
    }
  });

  it("does not turn a foreign key violation into a typed conflict: it rejects with 23503 and rolls back", async () => {
    const fx = await fixture("ForeignKey");
    const [tenant] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Other Tenant') returning id`;
    const [foreign] = await owner<{ id: string }[]>`
      insert into suppliers (tenant_id, name) values (${tenant?.id ?? ""}, 'FOREIGN SUPPLIER') returning id`;
    const attempt = app.begin(async (tx) => {
      const { suppliers, equipment } = createPostgresFleetTx(tx, (handle) => new PostgresOperationDirectory(handle));
      await suppliers.rename(fx.supplier.tenantId, fx.supplier.id, "Renamed In Transaction");
      return equipment.update({ ...fx.equipment, supplierId: foreign?.id ?? "" });
    });
    await expect(attempt).rejects.toMatchObject({ code: "23503" });
    const rows = await owner`select supplier_id, (select name from suppliers where id = ${fx.supplier.id}) as name
                             from equipments where id = ${fx.equipment.id}`;
    expect(rows[0]).toMatchObject({ supplier_id: fx.supplier.id, name: fx.supplier.name });
    expect(await audits(fx.equipment.id)).toHaveLength(1);
  });

  it("rolls the archive back when the audit write fails", async () => {
    const fx = await fixture("Rollback");
    const failing: AuditLog = { record: () => Promise.reject(new Error("audit unavailable")) };
    const broken = createContainer(app, { hasher, wrapAudit: () => failing });
    await expect(broken.fleet.archiveEquipment.execute({ ...asAnalyst("Baja"), id: fx.equipment.id })).rejects.toThrow(/audit unavailable/);
    const stored = await owner<{ archived_at: Date | null }[]>`select archived_at from equipments where id = ${fx.equipment.id}`;
    expect(stored[0]?.archived_at).toBeNull();
    await expect(broken.fleet.createSupplier.execute({ actor: adminActor, name: "Never stored" })).rejects.toThrow(/audit unavailable/);
    expect(await owner`select 1 from suppliers where name = 'NEVER STORED'`).toHaveLength(0);
  });
});

describe("fleet races", () => {
  type Attempts = PromiseSettledResult<Result<unknown, { code: string }>>[];
  const outcomes = (attempts: Attempts): string[] =>
    attempts.map((a) => (a.status === "rejected" ? `rejected: ${JSON.stringify(a.reason)}` : code(a.value))).sort();

  /** The invariant of D5: no active equipment under an archived supplier or asset type. */
  const orphans = () =>
    owner`select e.id from equipments e
          join suppliers s on s.id = e.supplier_id join asset_types t on t.id = e.asset_type_id
          where e.archived_at is null and (s.archived_at is not null or t.archived_at is not null)`;

  it("two creates of one supplier name give one ok and one name_taken, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const name = `Race Supplier ${String(round)}`;
      const create = () => f().createSupplier.execute({ actor: adminActor, name });
      expect(outcomes(await Promise.allSettled([create(), create()]))).toEqual(["name_taken", "ok"]);
      const type = () => f().createAssetType.execute({ actor: adminActor, name, meterKind: "none", preventiveIntervalHours: null });
      expect(outcomes(await Promise.allSettled([type(), type()]))).toEqual(["name_taken", "ok"]);
    }
  });

  it("two creates of one internal code under one supplier give one ok and one internal_code_taken", async () => {
    for (let round = 0; round < 8; round += 1) {
      const fx = await fixture(`CodeTwice ${String(round)}`);
      const input = { actor: adminActor, ...equipmentFields(fx.supplier.id, fx.type.id, `RACE-${String(round)}`) };
      const attempts = await Promise.allSettled([f().createEquipment.execute(input), f().createEquipment.execute(input)]);
      expect(outcomes(attempts)).toEqual(["internal_code_taken", "ok"]);
      const rows = await owner`select 1 from equipments where supplier_id = ${fx.supplier.id} and archived_at is null`;
      expect(rows).toHaveLength(2);
    }
  });

  it("two concurrent archives (and restores) of one row give one ok and one typed error", async () => {
    for (let round = 0; round < 8; round += 1) {
      const fx = await fixture(`Twice ${String(round)}`);
      const input = { ...asAnalyst("Baja"), id: fx.equipment.id };
      const archives = await Promise.allSettled([f().archiveEquipment.execute(input), f().archiveEquipment.execute(input)]);
      expect(outcomes(archives)).toEqual(["already_archived", "ok"]);
      const restores = await Promise.allSettled([f().restoreEquipment.execute(input), f().restoreEquipment.execute(input)]);
      expect(outcomes(restores)).toEqual(["not_archived", "ok"]);
      expect(await audits(fx.equipment.id)).toHaveLength(3);
    }
  });

  const oneWins = (attempts: Attempts): void => {
    expect(["has_active_equipment,ok", "ok,parent_archived"]).toContain(outcomes(attempts).join(","));
  };

  it("a create races the archive of its supplier or its asset type: one wins and nothing is orphaned", async () => {
    for (let round = 0; round < 8; round += 1) {
      const n = String(round);
      const [s1, t1] = [await addSupplier(`CreateSup ${n}`), await addType(`CreateSupType ${n}`)];
      const create1 = f().createEquipment.execute({ actor: adminActor, ...equipmentFields(s1.id, t1.id, `CS-${n}`) });
      oneWins(await Promise.allSettled([create1, f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: s1.id })]));
      expect(await orphans()).toHaveLength(0);
      const [s2, t2] = [await addSupplier(`CreateTyp ${n}`), await addType(`CreateTypType ${n}`)];
      const create2 = f().createEquipment.execute({ actor: adminActor, ...equipmentFields(s2.id, t2.id, `CT-${n}`) });
      oneWins(await Promise.allSettled([create2, f().archiveAssetType.execute({ ...asAnalyst("Baja"), id: t2.id })]));
      expect(await orphans()).toHaveLength(0);
    }
  });

  it("an update that moves an equipment races the archive of the target supplier: one wins and nothing is orphaned", async () => {
    for (let round = 0; round < 8; round += 1) {
      const fx = await fixture(`MoveRace ${String(round)}`);
      const target = await addSupplier(`MoveTarget ${String(round)}`);
      const move = f().updateEquipment.execute({
        actor: adminActor, id: fx.equipment.id, ...equipmentFields(target.id, fx.type.id, fx.equipment.internalCode), reason: "Traslado",
      });
      oneWins(await Promise.allSettled([move, f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: target.id })]));
      expect(await orphans()).toHaveLength(0);
    }
  });

  it("a restore races a create of the same internal code: one ok and one internal_code_taken", async () => {
    for (let round = 0; round < 8; round += 1) {
      const fx = await fixture(`RestoreCode ${String(round)}`);
      must(await f().archiveEquipment.execute({ ...asAnalyst("Baja"), id: fx.equipment.id }));
      const create = f().createEquipment.execute({
        actor: adminActor, ...equipmentFields(fx.supplier.id, fx.type.id, fx.equipment.internalCode),
      });
      const restore = f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id });
      expect(outcomes(await Promise.allSettled([create, restore]))).toEqual(["internal_code_taken", "ok"]);
      const rows = await owner`select 1 from equipments where supplier_id = ${fx.supplier.id} and archived_at is null`;
      expect(rows).toHaveLength(1);
    }
  });

  it("a restore races the archive of its supplier: one wins and nothing is orphaned", async () => {
    for (let round = 0; round < 8; round += 1) {
      const fx = await fixture(`RestoreRace ${String(round)}`);
      must(await f().archiveEquipment.execute({ ...asAnalyst("Baja"), id: fx.equipment.id }));
      const restore = f().restoreEquipment.execute({ ...asAnalyst("Volver"), id: fx.equipment.id });
      const attempts = await Promise.allSettled([restore, f().archiveSupplier.execute({ ...asAnalyst("Baja"), id: fx.supplier.id })]);
      oneWins(attempts);
      expect(await orphans()).toHaveLength(0);
    }
  });
});
