import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import { PostgresAssignmentDirectory } from "../../src/fleet/infrastructure/postgres-assignment-directory";
import { PostgresEquipmentDirectory } from "../../src/fleet/infrastructure/postgres-equipment-directory";
import { PostgresOperationDirectory } from "../../src/organization/infrastructure/postgres-operation-directory";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import { type Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";

// ADR-0013 / issue 54: battery kind on equipment and a spare that belongs to a SITE (operation and division
// null). Schema checks run as the owner; every flow runs as the restricted login through the real use cases.

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });
const APP_ROLE = "parkline_app";

let admin: Sql;
let owner: Sql;
let app: Sql;
let c: Container;
let adminActor: Actor;
let analyst: Actor;

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 2, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  owner = postgres(url.toString(), { max: 4, onnotice: () => undefined });
  await migrate(owner, MIGRATIONS_DIR);
  app = postgres(url.toString(), { max: 10, onnotice: () => undefined, connection: { role: APP_ROLE } });
  c = createContainer(app, { hasher });
  const credentials = { email: "admin@example.test", password: PASSWORD };
  must(await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials }));
  adminActor = await signInActor(credentials.email);
  analyst = await staff("analyst@example.test", "fleet_analyst");
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

async function createUser(email: string, role: Role, scope?: { type: string; id: string }): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role, ...(scope ? { scope } : {}) }));
  return signInActor(email);
}

const staff = (email: string, role: Role): Promise<Actor> => createUser(email, role);

type PgError = { code?: string; message: string; constraint_name?: string };
const failure = (run: PromiseLike<unknown>): Promise<PgError | null> =>
  Promise.resolve(run).then(
    () => null,
    (error: unknown) => error as PgError,
  );
const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const today = (): string => new Date().toISOString().slice(0, 10);

let counter = 0;
const next = (): string => String((counter += 1));

async function equipmentFixture(label: string, battery: { kind: string; quantity: number | null } = { kind: "combustion", quantity: null }) {
  const n = next();
  const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `${label} Supplier ${n}` }));
  const type = must(await c.fleet.createAssetType.execute({ actor: adminActor, name: `${label} Type ${n}`, meterKind: "hours", preventiveIntervalHours: 250 }));
  return must(
    await c.fleet.createEquipment.execute({
      actor: adminActor, supplierId: supplier.id, assetTypeId: type.id, internalCode: `EQ-${n}`,
      brand: "Brand", model: "Model", year: null, serialNumber: null,
      batteryKind: battery.kind, batteryQuantity: battery.quantity, observations: null,
    }),
  );
}

async function siteFixture(label: string) {
  return must(await c.organization.createSite.execute({ actor: adminActor, name: `${label} Site ${next()}` }));
}

async function operationFixture(label: string, site?: { id: string }) {
  const n = next();
  const o = c.organization;
  const division = must(await o.createBusinessUnit.execute({ actor: adminActor, name: `${label} Division ${n}` }));
  const own = site ?? (await siteFixture(label));
  const costCenter = String(2000 + Number(n)).padStart(4, "0");
  const operation = must(
    await o.createOperation.execute({ actor: adminActor, businessUnitId: division.id, siteId: own.id, name: `${label} Operation ${n}`, costCenter }),
  );
  return { division, site: own, operation };
}

type StoredRow = { valid_from: string; valid_to: string | null; kind: string; operation_id: string | null; business_unit_id: string | null; site_id: string; reason: string | null };
const stored = (equipmentId: string) =>
  owner<StoredRow[]>`
    select to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to, kind,
           operation_id, business_unit_id, site_id, reason
    from equipment_assignments where equipment_id = ${equipmentId} order by valid_from`;

const f = () => c.fleet;
const assign = (equipmentId: string, operationId: string, extra: { day?: string; reason?: string; actor?: Actor } = {}) =>
  f().assignEquipment.execute({ actor: extra.actor ?? analyst, equipmentId, target: { operationId }, day: extra.day ?? today(), reason: extra.reason });
const assignSpare = (equipmentId: string, siteId: string, extra: { day?: string; reason?: string; actor?: Actor } = {}) =>
  f().assignEquipment.execute({ actor: extra.actor ?? analyst, equipmentId, target: { siteId }, day: extra.day ?? today(), reason: extra.reason });

describe("migration 0013: battery kind", () => {
  const insertEquipment = async (label: string, kind: string | null, quantity: number | null) => {
    const n = next();
    const [supplier] = await owner<{ id: string }[]>`insert into suppliers (tenant_id, name) values (${adminActor.tenantId}, ${`${label} S ${n}`}) returning id`;
    const [type] = await owner<{ id: string }[]>`insert into asset_types (tenant_id, name, meter_kind) values (${adminActor.tenantId}, ${`${label} T ${n}`}, 'none') returning id`;
    return failure(owner`
      insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code, battery_kind, battery_quantity)
      values (${adminActor.tenantId}, ${supplier?.id ?? ""}, ${type?.id ?? ""}, ${`B-${n}`}, ${kind}, ${quantity})`);
  };

  it("holds only printable ASCII and line feeds (migration file hygiene)", () => {
    const text = readFileSync(resolve(MIGRATIONS_DIR, "0013_equipment_registration.sql"), "utf8");
    expect(text.replace(/\r\n/g, "\n").match(/[^\x20-\x7E\n]/g) ?? []).toEqual([]);
  });

  it("adds a nullable text column", async () => {
    const [col] = await owner<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable from information_schema.columns where table_name = 'equipments' and column_name = 'battery_kind'`;
    expect(col).toEqual({ data_type: "text", is_nullable: "YES" });
  });

  it("accepts the three kinds and refuses any other value", async () => {
    for (const kind of ["lithium", "lead_acid", "combustion"]) expect(await insertEquipment("Kind", kind, null)).toBeNull();
    const bad = await insertEquipment("Kind", "gas", null);
    expect(bad?.code).toBe("23514");
    expect(bad?.constraint_name).toBe("equipments_battery_kind_check");
  });

  it("allows a quantity only for lead acid, and keeps an old row (quantity without kind) valid", async () => {
    expect(await insertEquipment("Qty", "lead_acid", 4)).toBeNull();
    expect(await insertEquipment("Qty", "lead_acid", null)).toBeNull();
    expect(await insertEquipment("Qty", null, 2)).toBeNull();
    expect(await insertEquipment("Qty", null, null)).toBeNull();
    for (const kind of ["lithium", "combustion"]) {
      for (const quantity of [0, 2]) {
        const error = await insertEquipment("Qty", kind, quantity);
        expect(error?.code, `${kind} ${String(quantity)}`).toBe("23514");
        expect(error?.constraint_name).toBe("equipments_battery_quantity_kind_check");
      }
    }
    const tooMany = await insertEquipment("Qty", "lead_acid", 5);
    expect(tooMany?.code).toBe("23514");
  });

  it("stores the kind and the quantity through the use cases as parkline_app, and audits them", async () => {
    const eq = await equipmentFixture("Battery", { kind: "lead_acid", quantity: 3 });
    expect(eq).toMatchObject({ batteryKind: "lead_acid", batteryQuantity: 3 });
    const [row] = await owner<{ battery_kind: string; battery_quantity: number }[]>`select battery_kind, battery_quantity from equipments where id = ${eq.id}`;
    expect(row).toEqual({ battery_kind: "lead_acid", battery_quantity: 3 });
    const [entry] = await owner<{ after: { batteryKind: string; batteryQuantity: number } }[]>`
      select after from audit_log where action = 'fleet.equipment.create' and entity_id = ${eq.id}`;
    expect(entry?.after).toMatchObject({ batteryKind: "lead_acid", batteryQuantity: 3 });
    const edited = must(await f().updateEquipment.execute({
      actor: analyst, id: eq.id, reason: "Switch to lithium", supplierId: eq.supplierId, assetTypeId: eq.assetTypeId,
      internalCode: eq.internalCode, brand: eq.brand, model: eq.model, year: eq.year, serialNumber: eq.serialNumber,
      batteryKind: "lithium", batteryQuantity: null, observations: eq.observations,
    }));
    expect(edited).toMatchObject({ batteryKind: "lithium", batteryQuantity: null });
    const refused = await f().updateEquipment.execute({
      actor: analyst, id: eq.id, reason: "Bad", supplierId: eq.supplierId, assetTypeId: eq.assetTypeId,
      internalCode: eq.internalCode, brand: eq.brand, model: eq.model, year: eq.year, serialNumber: eq.serialNumber,
      batteryKind: "lithium", batteryQuantity: 2, observations: eq.observations,
    });
    expect(code(refused)).toBe("battery_quantity_not_allowed");
  });

  it("keeps an old row (no kind) readable and archivable, and editable only with a kind", async () => {
    const eq = await equipmentFixture("Old");
    await owner`update equipments set battery_kind = null, battery_quantity = 2 where id = ${eq.id}`;
    expect(must(await f().getEquipment.execute({ actor: analyst, id: eq.id }))).toMatchObject({ batteryKind: null, batteryQuantity: 2 });
    const edit = (batteryKind: string | null, batteryQuantity: number | null) => f().updateEquipment.execute({
      actor: analyst, id: eq.id, reason: "Complete", supplierId: eq.supplierId, assetTypeId: eq.assetTypeId, internalCode: eq.internalCode,
      brand: eq.brand, model: eq.model, year: eq.year, serialNumber: eq.serialNumber, batteryKind, batteryQuantity, observations: eq.observations,
    });
    expect(code(await edit(null, 2))).toBe("invalid_battery_kind");
    expect(code(await edit("lead_acid", 2))).toBe("ok");
    const old = await equipmentFixture("Old2");
    await owner`update equipments set battery_kind = null where id = ${old.id}`;
    must(await f().archiveEquipment.execute({ actor: analyst, id: old.id, reason: "Retired" }));
  });
});

describe("migration 0013: assignments at a site", () => {
  const insert = (equipmentId: string, fields: { kind: string; division: string | null; operation: string | null; site: string; from?: string; to?: string | null }) =>
    owner`
      insert into equipment_assignments (tenant_id, equipment_id, business_unit_id, operation_id, site_id, kind, valid_from, valid_to, created_by)
      values (${adminActor.tenantId}, ${equipmentId}, ${fields.division}, ${fields.operation}, ${fields.site}, ${fields.kind},
              ${fields.from ?? "2026-01-01"}::date, ${fields.to ?? null}::date, ${adminActor.userId})`;

  it("makes the operation and the division nullable and adds the partial index of open site spares", async () => {
    const cols = await owner<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'equipment_assignments' and column_name in ('operation_id', 'business_unit_id', 'site_id')`;
    expect(Object.fromEntries(cols.map((col) => [col.column_name, col.is_nullable]))).toEqual({ operation_id: "YES", business_unit_id: "YES", site_id: "NO" });
    const index = await owner<{ indexdef: string }[]>`select indexdef from pg_indexes where indexname = 'equipment_assignments_site_spare_idx'`;
    expect(index).toHaveLength(1);
    expect(index[0]?.indexdef).toMatch(/operation_id IS NULL/i);
  });

  it("accepts a spare at a site, a spare inside an operation (old shape) and an active assignment", async () => {
    const org = await operationFixture("Shapes");
    const [a, b, d] = [await equipmentFixture("ShapeA"), await equipmentFixture("ShapeB"), await equipmentFixture("ShapeC")];
    expect(await failure(insert(a.id, { kind: "spare", division: null, operation: null, site: org.site.id }))).toBeNull();
    expect(await failure(insert(b.id, { kind: "spare", division: org.division.id, operation: org.operation.id, site: org.site.id }))).toBeNull();
    expect(await failure(insert(d.id, { kind: "active", division: org.division.id, operation: org.operation.id, site: org.site.id }))).toBeNull();
  });

  it("refuses an active assignment without an operation and an operation without its division (and the reverse)", async () => {
    const org = await operationFixture("Bad");
    const eq = await equipmentFixture("Bad");
    const activeNone = await failure(insert(eq.id, { kind: "active", division: null, operation: null, site: org.site.id }));
    expect(activeNone?.code).toBe("23514");
    expect(activeNone?.constraint_name).toBe("equipment_assignments_active_has_operation_check");
    const opOnly = await failure(insert(eq.id, { kind: "spare", division: null, operation: org.operation.id, site: org.site.id }));
    expect(opOnly?.constraint_name).toBe("equipment_assignments_operation_division_check");
    const divisionOnly = await failure(insert(eq.id, { kind: "spare", division: org.division.id, operation: null, site: org.site.id }));
    expect(divisionOnly?.constraint_name).toBe("equipment_assignments_operation_division_check");
    const activeOpOnly = await failure(insert(eq.id, { kind: "active", division: null, operation: org.operation.id, site: org.site.id }));
    expect(activeOpOnly?.code).toBe("23514");
  });

  it("keeps the foreign key of the site for a spare, and the no-overlap rule between spares and active rows", async () => {
    const org = await operationFixture("Overlap");
    const eq = await equipmentFixture("Overlap");
    expect((await failure(insert(eq.id, { kind: "spare", division: null, operation: null, site: "00000000-0000-4000-8000-000000000000" })))?.code).toBe("23503");
    expect(await failure(insert(eq.id, { kind: "spare", division: null, operation: null, site: org.site.id, from: "2026-01-01", to: "2026-01-31" }))).toBeNull();
    const overlapping = await failure(insert(eq.id, { kind: "active", division: org.division.id, operation: org.operation.id, site: org.site.id, from: "2026-01-31", to: null }));
    expect(overlapping?.code).toBe("23P01");
    expect(overlapping?.constraint_name).toBe("equipment_assignments_no_overlap");
    expect(await failure(insert(eq.id, { kind: "active", division: org.division.id, operation: org.operation.id, site: org.site.id, from: "2026-02-01", to: null }))).toBeNull();
  });

  it("leaves the privileges of parkline_app as they were: select, insert and update, never delete or truncate", async () => {
    expect((await failure(app`delete from equipment_assignments where false`))?.code).toBe("42501");
    expect((await failure(app`truncate equipment_assignments`))?.code).toBe("42501");
    expect((await failure(app`delete from equipments where false`))?.code).toBe("42501");
    expect(await failure(app`update equipment_assignments set reason = reason where false`)).toBeNull();
    expect(await failure(app`update equipments set battery_kind = battery_kind where false`)).toBeNull();
    const grants = await owner<{ privilege_type: string }[]>`
      select privilege_type from information_schema.role_table_grants where grantee = ${APP_ROLE} and table_name = 'equipment_assignments' order by privilege_type`;
    expect(grants.map((g) => g.privilege_type)).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });
});

describe("spares at a site through the use cases as parkline_app", () => {
  it("assigns, lists and audits a spare: no operation, no division, the site audited", async () => {
    const site = await siteFixture("Spare");
    const eq = await equipmentFixture("Spare");
    const made = must(await assignSpare(eq.id, site.id));
    expect(made).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: site.id });
    expect(await stored(eq.id)).toMatchObject([{ kind: "spare", operation_id: null, business_unit_id: null, site_id: site.id }]);
    const [entry] = await owner<{ site_id: string; operation_id: string | null; business_unit_id: string | null; subject_equipment_id: string }[]>`
      select site_id, operation_id, business_unit_id, subject_equipment_id from audit_log
      where action = 'fleet.assignment.create' and entity_id = ${made.id}`;
    expect(entry).toEqual({ site_id: site.id, operation_id: null, business_unit_id: null, subject_equipment_id: eq.id });
    const listed = must(await f().listEquipmentAssignments.execute({ actor: analyst, equipmentId: eq.id }));
    expect(listed.map((a) => [a.operationId, a.siteId, a.kind])).toEqual([[null, site.id, "spare"]]);
  });

  it("creates an equipment already born as a spare of a site, with both audit entries", async () => {
    const site = await siteFixture("Born");
    const n = next();
    const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `Born Supplier ${n}` }));
    const type = must(await c.fleet.createAssetType.execute({ actor: adminActor, name: `Born Type ${n}`, meterKind: "none", preventiveIntervalHours: null }));
    const created = must(await c.fleet.createEquipment.execute({
      actor: analyst, supplierId: supplier.id, assetTypeId: type.id, internalCode: `BORN-${n}`, brand: "B", model: "M", year: null, serialNumber: null,
      batteryKind: "lithium", batteryQuantity: null, observations: null, assignment: { target: { siteId: site.id }, day: today(), reason: null },
    }));
    expect(await stored(created.id)).toMatchObject([{ kind: "spare", operation_id: null, site_id: site.id }]);
  });

  it("moves between targets: operation to site, site to operation and site to site, keeping the days contiguous", async () => {
    const a = await operationFixture("MoveA");
    const b = await operationFixture("MoveB");
    const eq = await equipmentFixture("Move");
    must(await assign(eq.id, a.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, target: { siteId: a.site.id }, day: "2026-02-01", reason: "Idle" }));
    must(await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, target: { siteId: b.site.id }, day: "2026-03-01", reason: "Other site" }));
    must(await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, target: { operationId: b.operation.id }, day: "2026-04-01", reason: "Covers it" }));
    expect((await stored(eq.id)).map((r) => [r.valid_from, r.valid_to, r.kind, r.operation_id, r.site_id])).toEqual([
      ["2026-01-01", "2026-01-31", "active", a.operation.id, a.site.id],
      ["2026-02-01", "2026-02-28", "spare", null, a.site.id],
      ["2026-03-01", "2026-03-31", "spare", null, b.site.id],
      ["2026-04-01", null, "active", b.operation.id, b.site.id],
    ]);
    expect(code(await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, target: { operationId: b.operation.id }, day: "2026-05-01", reason: "Same" }))).toBe("same_operation");
  });

  it("corrects the target of an assignment from an operation to a site and back", async () => {
    const org = await operationFixture("Correct");
    const eq = await equipmentFixture("Correct");
    const first = must(await assign(eq.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    const toSite = must(await f().correctAssignment.execute({ actor: analyst, assignmentId: first.id, target: { siteId: org.site.id }, reason: "It was a spare" }));
    expect(toSite).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null });
    const back = must(await f().correctAssignment.execute({ actor: analyst, assignmentId: first.id, target: { operationId: org.operation.id }, reason: "It was not" }));
    expect(back).toMatchObject({ kind: "active", operationId: org.operation.id, businessUnitId: org.division.id });
    expect((await stored(eq.id)).map((r) => r.kind)).toEqual(["active"]);
  });

  it("replaces an equipment leaving the outgoing one as a spare of the site of the operation it leaves", async () => {
    const org = await operationFixture("Replace");
    const [outgoing, incoming] = [await equipmentFixture("Out"), await equipmentFixture("In")];
    must(await assign(outgoing.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    const result = must(await f().replaceEquipment.execute({
      actor: analyst, incomingEquipmentId: incoming.id, outgoingEquipmentId: outgoing.id, day: "2026-02-01", outgoing: "spare", reason: "New unit",
    }));
    expect(result.outgoing).toMatchObject({ kind: "spare", operationId: null, businessUnitId: null, siteId: org.site.id });
    expect(await stored(outgoing.id)).toMatchObject([
      { kind: "active", valid_to: "2026-01-31", operation_id: org.operation.id },
      { kind: "spare", valid_from: "2026-02-01", valid_to: null, operation_id: null, business_unit_id: null, site_id: org.site.id },
    ]);
    expect(await stored(incoming.id)).toMatchObject([{ kind: "active", operation_id: org.operation.id }]);
    const again = await f().replaceEquipment.execute({
      actor: analyst, incomingEquipmentId: (await equipmentFixture("In2")).id, outgoingEquipmentId: outgoing.id, day: "2026-03-01", outgoing: "spare", reason: "x",
    });
    expect(code(again)).toBe("invalid_assignment_target");
  });

  it("refuses to give a spare to an archived site and blocks archiving a site with an open spare", async () => {
    const live = await siteFixture("Block");
    const gone = await siteFixture("Gone");
    must(await c.organization.archiveSite.execute({ actor: analyst, id: gone.id, reason: "Closed" }));
    const eq = await equipmentFixture("Block");
    expect(code(await assignSpare(eq.id, gone.id))).toBe("site_archived");
    expect(await stored(eq.id)).toHaveLength(0);
    must(await assignSpare(eq.id, live.id, { day: "2026-01-01", reason: "Backfill" }));
    expect(code(await c.organization.archiveSite.execute({ actor: analyst, id: live.id, reason: "Closed" }))).toBe("has_open_assignments");
    must(await f().endAssignment.execute({ actor: analyst, equipmentId: eq.id, day: "2026-01-31", reason: "Parked" }));
    must(await c.organization.archiveSite.execute({ actor: analyst, id: live.id, reason: "Closed" }));
    expect(code(await assignSpare(eq.id, live.id, { day: "2026-03-01", reason: "Late" }))).toBe("site_archived");
  });

  it("counts the open spares of a site through the fleet adapter, per tenant and per site", async () => {
    const site = await siteFixture("Count");
    const org = await operationFixture("CountOp", site);
    const [spare, active] = [await equipmentFixture("CountS"), await equipmentFixture("CountA")];
    must(await assignSpare(spare.id, site.id));
    must(await assign(active.id, org.operation.id));
    await app.begin(async (tx) => {
      const directory = new PostgresAssignmentDirectory(tx);
      expect(await directory.countOpenSpares(adminActor.tenantId, site.id)).toBe(1);
      expect(await directory.countOpen(adminActor.tenantId, org.operation.id)).toBe(1);
      expect(await directory.countOpenSpares(adminActor.tenantId, org.site.id)).toBe(1);
      expect(await directory.countOpenSpares(adminActor.tenantId, "not-a-uuid")).toBe(0);
      expect(await directory.countOpenSpares("not-a-uuid", site.id)).toBe(0);
    });
  });

  it("reads a site through the organization directory with a shared lock, and answers null for a foreign or malformed id", async () => {
    const site = await siteFixture("Dir");
    await app.begin(async (tx) => {
      const directory = new PostgresOperationDirectory(tx);
      expect(await directory.findSite(adminActor.tenantId, site.id)).toEqual({ id: site.id, archivedAt: null });
      expect(await directory.findSite(adminActor.tenantId, "not-a-uuid")).toBeNull();
      expect(await directory.findSite("not-a-uuid", site.id)).toBeNull();
      expect(await directory.findSite(adminActor.tenantId, "00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });

  it("gives the equipment directory (metering) the position of a site spare: tenant and site only", async () => {
    const site = await siteFixture("Pos");
    const org = await operationFixture("PosOp");
    const [spare, active, none] = [await equipmentFixture("PosS"), await equipmentFixture("PosA"), await equipmentFixture("PosN")];
    must(await assignSpare(spare.id, site.id));
    must(await assign(active.id, org.operation.id));
    await app.begin(async (tx) => {
      const directory = new PostgresEquipmentDirectory(tx);
      expect((await directory.find(adminActor.tenantId, spare.id, { lock: false }))?.position).toEqual({ tenantId: adminActor.tenantId, siteId: site.id });
      expect((await directory.find(adminActor.tenantId, active.id, { lock: true }))?.position).toEqual({
        tenantId: adminActor.tenantId, businessUnitId: org.division.id, operationId: org.operation.id, siteId: org.site.id,
      });
      expect((await directory.find(adminActor.tenantId, none.id, { lock: false }))?.position).toBeNull();
    });
  });
});

describe("who sees a spare at a site", () => {
  it("shows it to company-wide readers and hides it, like a missing id, from division and operation scopes", async () => {
    const org = await operationFixture("Scope");
    const eq = await equipmentFixture("Scope");
    must(await assignSpare(eq.id, org.site.id));
    const manager = await createUser(`manager-${next()}@example.test`, "manager", { type: "business_unit", id: org.division.id });
    const supervisor = await createUser(`supervisor-${next()}@example.test`, "supervisor", { type: "operation", id: org.operation.id });
    for (const reader of [adminActor, analyst]) {
      expect(must(await f().listEquipment.execute({ actor: reader })).map((e) => e.id)).toContain(eq.id);
      expect(must(await f().getEquipment.execute({ actor: reader, id: eq.id })).assignment).toMatchObject({ kind: "spare", operationId: null, siteId: org.site.id });
    }
    for (const scoped of [manager, supervisor]) {
      expect(must(await f().listEquipment.execute({ actor: scoped })).map((e) => e.id)).not.toContain(eq.id);
      const hidden = await f().getEquipment.execute({ actor: scoped, id: eq.id });
      expect(code(hidden)).toBe("not_found");
      expect(must(await f().listEquipmentAssignments.execute({ actor: scoped, equipmentId: eq.id }))).toEqual([]);
    }
  });

  it("does not let a scoped writer assign, move or read readings of a site spare", async () => {
    const org = await operationFixture("ScopedWrite");
    const eq = await equipmentFixture("ScopedWrite");
    must(await assign(eq.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    const scopedAnalyst = await createUser(`scoped-analyst-${next()}@example.test`, "fleet_analyst", { type: "operation", id: org.operation.id });
    expect(code(await assignSpare((await equipmentFixture("ScopedFree")).id, org.site.id, { actor: scopedAnalyst }))).toBe("forbidden");
    expect(code(await f().moveEquipment.execute({ actor: scopedAnalyst, equipmentId: eq.id, target: { siteId: org.site.id }, day: "2026-02-01", reason: "Idle" }))).toBe("forbidden");
    must(await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, target: { siteId: org.site.id }, day: "2026-02-01", reason: "Idle" }));
    const reading = await c.metering.recordReading.execute({ actor: scopedAnalyst, equipmentId: eq.id, day: today(), value: 5 });
    expect(code(reading)).toBe("not_found");
    expect(code(await c.metering.recordReading.execute({ actor: adminActor, equipmentId: eq.id, day: today(), value: 5 }))).toBe("ok");
  });
});

describe("races over spares at a site", () => {
  it("a spare assignment racing the archive of its site: exactly one wins, never both, over several rounds", async () => {
    for (let round = 0; round < 6; round += 1) {
      const site = await siteFixture(`RaceArchive${String(round)}`);
      const eq = await equipmentFixture(`RaceArchive${String(round)}`);
      const [assigned, archived] = await Promise.all([
        assignSpare(eq.id, site.id),
        c.organization.archiveSite.execute({ actor: analyst, id: site.id, reason: "Closed" }),
      ]);
      const outcome = [code(assigned), code(archived)];
      expect([["ok", "has_open_assignments"], ["site_archived", "ok"]], outcome.join()).toContainEqual(outcome);
      const open = await owner<{ n: number }[]>`select count(*)::int as n from equipment_assignments where site_id = ${site.id} and valid_to is null`;
      const [siteRow] = await owner<{ archived_at: Date | null }[]>`select archived_at from sites where id = ${site.id}`;
      expect(open[0]?.n === 1 && siteRow?.archived_at === null || open[0]?.n === 0 && siteRow?.archived_at !== null).toBe(true);
    }
  });

  it("two assignments of the same equipment, one to an operation and one to a site: exactly one wins", async () => {
    for (let round = 0; round < 6; round += 1) {
      const org = await operationFixture(`RaceTwo${String(round)}`);
      const eq = await equipmentFixture(`RaceTwo${String(round)}`);
      const results = await Promise.all([assign(eq.id, org.operation.id), assignSpare(eq.id, org.site.id)]);
      expect(results.map(code).sort(), `round ${String(round)}`).toEqual(["ok", "open_assignment_exists"]);
      expect(await stored(eq.id)).toHaveLength(1);
    }
  });

  it("a replace racing a move of the outgoing equipment ends in one consistent state, with no deadlock", async () => {
    for (let round = 0; round < 6; round += 1) {
      const org = await operationFixture(`RaceReplace${String(round)}`);
      const other = await siteFixture(`RaceReplaceOther${String(round)}`);
      const [outgoing, incoming] = [await equipmentFixture(`RROut${String(round)}`), await equipmentFixture(`RRIn${String(round)}`)];
      must(await assign(outgoing.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
      const results = await Promise.all([
        f().replaceEquipment.execute({ actor: analyst, incomingEquipmentId: incoming.id, outgoingEquipmentId: outgoing.id, day: "2026-02-01", outgoing: "spare", reason: "New unit" }),
        f().moveEquipment.execute({ actor: analyst, equipmentId: outgoing.id, target: { siteId: other.id }, day: "2026-02-01", reason: "Idle" }),
      ]);
      const codes = results.map(code);
      expect(codes.filter((x) => x === "ok").length, codes.join()).toBeGreaterThanOrEqual(1);
      for (const x of codes) expect(["ok", "invalid_period", "no_open_assignment", "open_assignment_exists", "assignment_overlap"]).toContain(x);
      const rows = await stored(outgoing.id);
      expect(rows.filter((r) => r.valid_to === null).length).toBe(1);
      const open = await owner<{ n: number }[]>`select count(*)::int as n from equipment_assignments where equipment_id = ${incoming.id} and valid_to is null`;
      expect(open[0]?.n).toBe(codes[0] === "ok" ? 1 : 0);
    }
  });

  it("assigning spares to a site while other equipment moves between it and an operation never deadlocks", async () => {
    const org = await operationFixture("Churn");
    const equipment = await Promise.all([1, 2, 3, 4].map((i) => equipmentFixture(`Churn${String(i)}`)));
    for (const eq of equipment.slice(0, 2)) must(await assign(eq.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    const results = await Promise.all([
      assignSpare(equipment[2]?.id ?? "", org.site.id),
      assignSpare(equipment[3]?.id ?? "", org.site.id),
      f().moveEquipment.execute({ actor: analyst, equipmentId: equipment[0]?.id ?? "", target: { siteId: org.site.id }, day: "2026-02-01", reason: "Idle" }),
      f().moveEquipment.execute({ actor: analyst, equipmentId: equipment[1]?.id ?? "", target: { siteId: org.site.id }, day: "2026-02-01", reason: "Idle" }),
    ]);
    expect(results.map(code)).toEqual(["ok", "ok", "ok", "ok"]);
    await app.begin(async (tx) => {
      expect(await new PostgresAssignmentDirectory(tx).countOpenSpares(adminActor.tenantId, org.site.id)).toBe(4);
    });
  });
});
