import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import { PostgresEquipmentDirectory } from "../../src/fleet/infrastructure/postgres-equipment-directory";
import { createPostgresFleetTx } from "../../src/fleet/infrastructure/postgres-fleet-tx";
import { shiftDay } from "../../src/metering/domain/day";
import type { MeterReading } from "../../src/metering/domain/entities";
import { effectiveReadings } from "../../src/metering/domain/readings";
import { READING_HISTORY_LIMIT } from "../../src/metering/infrastructure/postgres-metering-repositories";
import { PostgresOperationDirectory } from "../../src/organization/infrastructure/postgres-operation-directory";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import { err, type Result } from "../../src/shared/domain/result";
import { SENSITIVE_AUDIT_ACTIONS } from "../../src/shared/domain/sensitive-actions";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";
import { PostgresUnitOfWork } from "../../src/shared/infrastructure/postgres-unit-of-work";

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
let url: URL;
let c: Container;
let adminActor: Actor;
let analyst: Actor;

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 2, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  owner = postgres(url.toString(), { max: 4, onnotice: () => undefined });
  await migrate(owner, MIGRATIONS_DIR);
  app = postgres(url.toString(), { max: 10, onnotice: () => undefined, connection: { role: APP_ROLE } });
  c = createContainer(app, { hasher });
  const credentials = { email: "admin@example.test", password: PASSWORD };
  must(await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials }));
  adminActor = await signInActor(credentials.email);
  analyst = await scopedStaff("analyst@example.test", "fleet_analyst");
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

/** A user with a role (over one scope when given), signed in. */
async function scopedStaff(email: string, role: Role, scope?: { type: string; id: string }): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role, scope }));
  return signInActor(email);
}

type PgError = { code?: string; message: string; constraint_name?: string };
const failure = (run: PromiseLike<unknown>): Promise<PgError | null> =>
  Promise.resolve(run).then(
    () => null,
    (error: unknown) => error as PgError,
  );
const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const D = (offset: number): string => shiftDay("2020-01-01", offset);
const today = (): string => new Date().toISOString().slice(0, 10);

let counter = 0;
const next = (): string => String((counter += 1));

/** A division, a site and an operation of their own. */
async function operationFixture(label: string) {
  const n = next();
  const o = c.organization;
  const division = must(await o.createBusinessUnit.execute({ actor: adminActor, name: `${label} Division ${n}` }));
  const site = must(await o.createSite.execute({ actor: adminActor, name: `${label} Site ${n}` }));
  const costCenter = String(1000 + Number(n)).padStart(4, "0");
  const operation = must(
    await o.createOperation.execute({ actor: adminActor, businessUnitId: division.id, siteId: site.id, name: `${label} Operation ${n}`, costCenter }),
  );
  return { division, site, operation };
}

/** A supplier, an asset type of the given meter kind and one equipment, optionally assigned to an operation. */
async function equipmentFixture(label: string, meterKind = "hours", operationId: string | null = null) {
  const n = next();
  const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `${label} Supplier ${n}` }));
  const type = must(
    await c.fleet.createAssetType.execute({ actor: adminActor, name: `${label} Type ${n}`, meterKind, preventiveIntervalHours: null }),
  );
  const equipment = must(
    await c.fleet.createEquipment.execute({
      actor: adminActor, supplierId: supplier.id, assetTypeId: type.id, internalCode: `EQ-${n}`,
      brand: "Brand", model: "Model", year: null, serialNumber: null, batteryQuantity: null, observations: null,
    }),
  );
  if (operationId !== null) {
    must(await c.fleet.assignEquipment.execute({ actor: adminActor, equipmentId: equipment.id, operationId, kind: "active", day: today() }));
  }
  return equipment.id;
}

const record = (equipmentId: string, day: string, value: number, actor: Actor = adminActor, container: Container = c) =>
  container.metering.recordReading.execute({ actor, equipmentId, day, value });
const correct = (equipmentId: string, readingId: string, value: number, reason = "Typing mistake", actor: Actor = adminActor) =>
  c.metering.correctReading.execute({ actor, equipmentId, readingId, value, reason });
const replace = (equipmentId: string, day: string, finalValue: number, initialValue: number, reason = "Meter broke", container: Container = c) =>
  container.metering.replaceMeter.execute({ actor: adminActor, equipmentId, day, finalValue, initialValue, reason });
const list = (equipmentId: string, actor: Actor = adminActor) => c.metering.listEquipmentReadings.execute({ actor, equipmentId });

type MeterRow = { kind: string; opened_on: string; closed_on: string | null; initial_value_tenths: number };
const meterRows = (equipmentId: string) =>
  owner<MeterRow[]>`
    select kind, to_char(opened_on, 'YYYY-MM-DD') as opened_on, to_char(closed_on, 'YYYY-MM-DD') as closed_on, initial_value_tenths
    from meters where equipment_id = ${equipmentId} order by opened_on, created_at`;

type ReadingRow = { id: string; meter_id: string; read_on: string; value_tenths: number; kind: string; corrects_id: string | null; reason: string | null; created_at: Date };
const readingRows = (equipmentId: string) =>
  owner<ReadingRow[]>`
    select r.id, r.meter_id, to_char(r.read_on, 'YYYY-MM-DD') as read_on, r.value_tenths, r.kind, r.corrects_id, r.reason, r.created_at
    from meter_readings r join meters m on m.tenant_id = r.tenant_id and m.id = r.meter_id
    where m.equipment_id = ${equipmentId} order by r.seq`;

type AuditRow = { id: string; action: string; entity_type: string; reason: string | null; operation_id: string | null; after: Record<string, unknown> | null };
const audits = (equipmentId: string, action?: string) =>
  owner<AuditRow[]>`
    select id, action, entity_type, reason, operation_id, after from audit_log
    where subject_equipment_id = ${equipmentId} and (${action ?? null}::text is null or action = ${action ?? null})
    order by id`;

/** Every meter's effective timeline is ordered, and a closed meter ends with its replacement_close. */
async function expectConsistent(equipmentId: string): Promise<void> {
  const meters = await owner<{ id: string; closed_on: string | null }[]>`
    select id, closed_on::text as closed_on from meters where equipment_id = ${equipmentId}`;
  expect(meters.filter((m) => m.closed_on === null).length).toBeLessThanOrEqual(1);
  const rows = await owner<ReadingRow[]>`
    select r.id, r.meter_id, to_char(r.read_on, 'YYYY-MM-DD') as read_on, r.value_tenths, r.kind, r.corrects_id, r.reason, r.created_at
    from meter_readings r join meters m on m.tenant_id = r.tenant_id and m.id = r.meter_id
    where m.equipment_id = ${equipmentId} order by r.read_on, r.created_at, r.seq`;
  for (const meter of meters) {
    const mine: MeterReading[] = rows
      .filter((r) => r.meter_id === meter.id)
      .map((r) => ({
        id: r.id, tenantId: adminActor.tenantId, meterId: r.meter_id, readOn: r.read_on, valueTenths: r.value_tenths,
        kind: r.kind as MeterReading["kind"], correctsId: r.corrects_id, reason: r.reason, createdBy: adminActor.userId, createdAt: r.created_at,
      }));
    const timeline = effectiveReadings(mine);
    const values = timeline.map((t) => t.valueTenths);
    expect(values, `meter ${meter.id}`).toEqual([...values].sort((a, b) => a - b));
    if (meter.closed_on !== null) expect(timeline.at(-1)?.kind).toBe("replacement_close");
  }
}

describe("metering schema", () => {
  it("has the expected columns", async () => {
    const columns = async (table: string) =>
      (await owner<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = ${table} order by ordinal_position`).map((r) => r.column_name);
    expect(await columns("meters")).toEqual([
      "id", "tenant_id", "equipment_id", "kind", "opened_on", "closed_on", "initial_value_tenths", "created_at",
    ]);
    expect(await columns("meter_readings")).toEqual([
      "id", "seq", "tenant_id", "meter_id", "read_on", "value_tenths", "kind", "corrects_id", "reason", "created_by", "created_at",
    ]);
  });

  const insertMeter = (over: Partial<{ equipment: string; tenant: string; kind: string; opened: string; closed: string | null; initial: number }> & { equipment: string }) =>
    owner<{ id: string }[]>`
      insert into meters (tenant_id, equipment_id, kind, opened_on, closed_on, initial_value_tenths)
      values (${over.tenant ?? adminActor.tenantId}, ${over.equipment}, ${over.kind ?? "hours"}, ${over.opened ?? D(0)}::date,
              ${over.closed ?? null}::date, ${over.initial ?? 0})
      returning id`;

  type ReadingOver = Partial<{ tenant: string; value: number; kind: string; corrects: string | null; reason: string | null; by: string; day: string }>;
  const insertReading = (meterId: string, over: ReadingOver = {}) =>
    owner<{ id: string }[]>`
      insert into meter_readings (tenant_id, meter_id, read_on, value_tenths, kind, corrects_id, reason, created_by)
      values (${over.tenant ?? adminActor.tenantId}, ${meterId}, ${over.day ?? D(0)}::date, ${over.value ?? 10}, ${over.kind ?? "reading"},
              ${over.corrects ?? null}, ${over.reason ?? null}, ${over.by ?? adminActor.userId})
      returning id`;

  it("rejects each check on meters: kind, value bounds and the closing day", async () => {
    const eq = await equipmentFixture("MeterChecks");
    expect((await failure(insertMeter({ equipment: eq, kind: "none" })))?.code).toBe("23514");
    expect((await failure(insertMeter({ equipment: eq, initial: -1 })))?.code).toBe("23514");
    expect((await failure(insertMeter({ equipment: eq, initial: 100_000_000 })))?.code).toBe("23514");
    expect((await failure(insertMeter({ equipment: eq, opened: D(5), closed: D(4) })))?.code).toBe("23514");
    expect(await failure(insertMeter({ equipment: eq, opened: D(5), closed: D(5), initial: 99_999_999 }))).toBeNull();
  });

  it("allows at most one OPEN meter per equipment (partial unique index) and a new one after closing", async () => {
    const eq = await equipmentFixture("OneOpen");
    const [first] = await insertMeter({ equipment: eq });
    expect((await failure(insertMeter({ equipment: eq })))?.code).toBe("23505");
    await owner`update meters set closed_on = ${D(1)}::date where id = ${first?.id ?? ""}`;
    expect(await failure(insertMeter({ equipment: eq, opened: D(1) }))).toBeNull();
    const other = await equipmentFixture("OneOpenOther");
    expect(await failure(insertMeter({ equipment: other }))).toBeNull();
  });

  it("rejects each check on readings: value bounds, kind, the correction link and the reason length", async () => {
    const eq = await equipmentFixture("ReadingChecks");
    const [meter] = await insertMeter({ equipment: eq });
    const meterId = meter?.id ?? "";
    const [base] = await insertReading(meterId);
    const baseId = base?.id ?? "";
    expect((await failure(insertReading(meterId, { value: -1 })))?.code).toBe("23514");
    expect((await failure(insertReading(meterId, { value: 100_000_000 })))?.code).toBe("23514");
    expect(await failure(insertReading(meterId, { value: 99_999_999 }))).toBeNull();
    expect((await failure(insertReading(meterId, { kind: "estimate" })))?.code).toBe("23514");
    expect((await failure(insertReading(meterId, { kind: "correction" })))?.code).toBe("23514");
    for (const kind of ["reading", "replacement_close", "replacement_open"]) {
      expect((await failure(insertReading(meterId, { kind, corrects: baseId })))?.code, kind).toBe("23514");
    }
    expect(await failure(insertReading(meterId, { kind: "correction", corrects: baseId, reason: "x" }))).toBeNull();
    expect((await failure(insertReading(meterId, { reason: "x".repeat(501) })))?.code).toBe("23514");
    expect(await failure(insertReading(meterId, { reason: "x".repeat(500) }))).toBeNull();
  });

  it("keeps every row in its tenant with composite foreign keys", async () => {
    const eq = await equipmentFixture("Keys");
    const [meter] = await insertMeter({ equipment: eq });
    const [tenant] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Other Tenant') returning id`;
    const otherTenant = tenant?.id ?? "";
    expect((await failure(insertMeter({ equipment: eq, tenant: otherTenant, opened: D(9) })))?.code).toBe("23503");
    expect((await failure(insertMeter({ equipment: randomUUID(), opened: D(9) })))?.code).toBe("23503");
    expect((await failure(insertReading(meter?.id ?? "", { tenant: otherTenant })))?.code).toBe("23503");
    expect((await failure(insertReading(randomUUID())))?.code).toBe("23503");
    expect((await failure(insertReading(meter?.id ?? "", { by: randomUUID() })))?.code).toBe("23503");
    const [base] = await insertReading(meter?.id ?? "");
    expect((await failure(insertReading(meter?.id ?? "", { kind: "correction", corrects: randomUUID() })))?.code).toBe("23503");
    expect(await failure(insertReading(meter?.id ?? "", { kind: "correction", corrects: base?.id ?? "", reason: "x" }))).toBeNull();
    expect((await failure(owner`delete from equipments where id = ${eq}`))?.code).toBe("23503");
  });

  it("holds only printable ASCII and line feeds (migration file hygiene)", () => {
    const text = readFileSync(resolve(MIGRATIONS_DIR, "0012_metering.sql"), "utf8");
    expect(text.replace(/\r\n/g, "\n").match(/[^\x20-\x7E\n]/g) ?? []).toEqual([]);
  });
});

describe("metering privileges of parkline_app", () => {
  const privileges = async (table: string) =>
    (await owner<{ p: string }[]>`
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
      where has_table_privilege(${APP_ROLE}, ${table}, p) order by p`).map((r) => r.p);

  it("readings are immutable: select and insert only", async () => {
    expect(await privileges("meter_readings")).toEqual(["INSERT", "SELECT"]);
  });

  it("meters can be read, created and closed, never deleted or truncated", async () => {
    expect(await privileges("meters")).toEqual(["INSERT", "SELECT"]);
    const columns = await owner<{ column_name: string }[]>`
      select column_name from information_schema.column_privileges
      where table_name = 'meters' and grantee = ${APP_ROLE} and privilege_type = 'UPDATE' order by column_name`;
    expect(columns.map((c) => c.column_name)).toEqual(["closed_on"]);
  });

  it("refuses with 42501 an update, delete or truncate of a reading and a delete or truncate of a meter, as the application", async () => {
    const eq = await equipmentFixture("Privileges");
    must(await record(eq, D(0), 10));
    expect((await failure(app`update meter_readings set value_tenths = 1`))?.code).toBe("42501");
    expect((await failure(app`delete from meter_readings`))?.code).toBe("42501");
    expect((await failure(app`truncate meter_readings`))?.code).toBe("42501");
    expect((await failure(app`delete from meters`))?.code).toBe("42501");
    expect((await failure(app`truncate meters`))?.code).toBe("42501");
    expect(await failure(app`update meters set closed_on = null where false`)).toBeNull();
    expect((await failure(app`update meters set opened_on = opened_on where false`))?.code).toBe("42501");
    expect((await failure(app`update meters set kind = kind where false`))?.code).toBe("42501");
    expect((await failure(app`update meters set initial_value_tenths = 0 where false`))?.code).toBe("42501");
    expect(await failure(app`select count(*) from meter_readings`)).toBeNull();
  });
});

describe("audit trigger for the metering actions", () => {
  const insertAudit = (action: string, reason: string | null) => owner`
    insert into audit_log
      (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id, origin, correlation_id, reason)
    values (gen_random_uuid(), 'actor-1', 'user', 'tester', ${action}, 'thing', 'thing-1', 'ui', 'corr-1', ${reason})`;

  it.each(["metering.reading.correct", "metering.meter.replace"])("%s needs a visible reason", async (action) => {
    for (const reason of [null, "", "  ", String.fromCharCode(0x200b, 0xa0, 0xfeff)]) {
      const error = await failure(insertAudit(action, reason));
      expect(error?.code, JSON.stringify(reason)).toBe("23514");
      expect(error?.message).toBe(`audit action "${action}" requires a non-blank reason`);
    }
    await insertAudit(action, "Documented reason");
  });

  it("does not demand a reason for metering.reading.create", async () => {
    await insertAudit("metering.reading.create", null);
  });

  it("matches the sensitive list in TypeScript for the metering actions", () => {
    expect(SENSITIVE_AUDIT_ACTIONS).toContain("metering.reading.correct");
    expect(SENSITIVE_AUDIT_ACTIONS).toContain("metering.meter.replace");
    expect(SENSITIVE_AUDIT_ACTIONS).not.toContain("metering.reading.create");
  });
});

describe("recording readings (real Postgres, as parkline_app)", () => {
  it("the first reading opens the meter of the kind the asset type measures, in exact tenths", async () => {
    const org = await operationFixture("First");
    const hours = await equipmentFixture("FirstH", "hours", org.operation.id);
    const km = await equipmentFixture("FirstK", "km", org.operation.id);
    const stored = must(await record(hours, D(0), 1234567.9));
    expect(stored.valueTenths).toBe(12_345_679);
    must(await record(km, D(0), 0.3));
    expect(await meterRows(hours)).toEqual([{ kind: "hours", opened_on: D(0), closed_on: null, initial_value_tenths: 12_345_679 }]);
    expect(await meterRows(km)).toEqual([{ kind: "km", opened_on: D(0), closed_on: null, initial_value_tenths: 3 }]);
    const rows = await readingRows(hours);
    expect(rows.map((r) => [r.read_on, r.value_tenths, r.kind])).toEqual([[D(0), 12_345_679, "reading"]]);
  });

  it("keeps readings in order and a backdated reading between its neighbors", async () => {
    const eq = await equipmentFixture("Order", "hours", (await operationFixture("Order")).operation.id);
    must(await record(eq, D(1), 100));
    must(await record(eq, D(3), 120.5));
    must(await record(eq, D(2), 110));
    must(await record(eq, D(3), 120.5));
    expect(code(await record(eq, D(2), 130))).toBe("reading_out_of_order");
    expect(code(await record(eq, D(4), 90))).toBe("reading_out_of_order");
    expect(code(await record(eq, D(0), 100.1))).toBe("reading_out_of_order");
    must(await record(eq, D(0), 99.9));
    expect(code(await record(eq, D(9), 5))).toBe("reading_out_of_order");
    expect(code(await record(eq, "2999-01-01", 500))).toBe("reading_in_future");
    expect(code(await record(eq, D(9), 0.25))).toBe("invalid_reading_value");
    await expectConsistent(eq);
    expect((await readingRows(eq)).map((r) => r.value_tenths)).toEqual([1000, 1205, 1100, 1205, 999]);
  });

  it("answers no_meter for a type without meter and equipment_archived for an archived equipment", async () => {
    const none = await equipmentFixture("NoMeter", "none");
    expect(code(await record(none, D(0), 1))).toBe("no_meter");
    expect(await meterRows(none)).toEqual([]);
    const archived = await equipmentFixture("Archived");
    must(await c.fleet.archiveEquipment.execute({ actor: analyst, id: archived, reason: "Baja" }));
    expect(code(await record(archived, D(0), 1))).toBe("equipment_archived");
    expect(code(await correct(archived, randomUUID(), 1))).toBe("equipment_archived");
  });

  it("writes the audit entry of each reading in the same transaction, with the equipment as subject and no reason needed", async () => {
    const org = await operationFixture("AuditCreate");
    const eq = await equipmentFixture("AuditCreate", "hours", org.operation.id);
    const reading = must(await record(eq, D(0), 10));
    const [entry] = await audits(eq, "metering.reading.create");
    expect(entry?.entity_type).toBe("meter_reading");
    expect(entry?.reason).toBeNull();
    expect(entry?.operation_id).toBe(org.operation.id);
    expect(entry?.after).toMatchObject({ equipmentId: eq, kind: "reading", day: D(0), value: 10 });
    expect(reading.id).toBeTruthy();
  });

  it("rolls the reading and the meter back when the audit entry fails", async () => {
    const eq = await equipmentFixture("AuditFail");
    const broken = createContainer(app, {
      hasher,
      wrapAudit: (inner) => ({ record: (entry) => (entry.action === "metering.reading.create" ? Promise.reject(new Error("boom")) : inner.record(entry)) }),
    });
    await expect(record(eq, D(0), 10, adminActor, broken)).rejects.toThrow("boom");
    expect(await meterRows(eq)).toEqual([]);
    expect(await readingRows(eq)).toEqual([]);
  });
});

describe("corrections", () => {
  it("never edits the reading: it adds a correction row, the original stays, and the effective value changes", async () => {
    const eq = await equipmentFixture("Correct", "hours", (await operationFixture("Correct")).operation.id);
    const first = must(await record(eq, D(1), 100));
    const second = must(await record(eq, D(2), 150));
    const fixed = must(await correct(eq, second.id, 140.5));
    expect(fixed.kind).toBe("correction");
    expect(fixed.correctsId).toBe(second.id);
    const rows = await readingRows(eq);
    expect(rows.map((r) => [r.kind, r.value_tenths, r.read_on])).toEqual([["reading", 1000, D(1)], ["reading", 1500, D(2)], ["correction", 1405, D(2)]]);
    const again = must(await correct(eq, fixed.id, 145));
    expect(again.correctsId).toBe(second.id);
    const listed = must(await list(eq));
    expect(listed.history.map((h) => [h.kind, h.value, h.superseded])).toEqual([
      ["correction", 145, false], ["correction", 140.5, true], ["reading", 150, true], ["reading", 100, false],
    ]);
    expect(listed.lastReading).toMatchObject({ id: second.id, value: 145 });
    expect(first.id).toBeTruthy();
    await expectConsistent(eq);
  });

  it("requires a reason, keeps the value between its neighbors and refuses a reading of another equipment", async () => {
    const org = await operationFixture("CorrectRules");
    const eq = await equipmentFixture("CorrectRules", "hours", org.operation.id);
    const other = await equipmentFixture("CorrectOther", "hours", org.operation.id);
    const a = must(await record(eq, D(1), 100));
    must(await record(eq, D(2), 150));
    expect(code(await correct(eq, a.id, 120, "   "))).toBe("reason_required");
    expect(code(await correct(eq, a.id, 160))).toBe("reading_out_of_order");
    expect(code(await correct(other, a.id, 120))).toBe("reading_not_found");
    expect((await readingRows(eq)).filter((r) => r.kind === "correction")).toHaveLength(0);
  });

  it("writes a sensitive audit entry with the reason, the old and the new value", async () => {
    const eq = await equipmentFixture("CorrectAudit", "hours", (await operationFixture("CorrectAudit")).operation.id);
    const reading = must(await record(eq, D(1), 100));
    must(await correct(eq, reading.id, 90, "Read the wrong meter"));
    const [entry] = await audits(eq, "metering.reading.correct");
    expect(entry?.reason).toBe("Read the wrong meter");
    expect(entry?.after).toMatchObject({ readingId: reading.id, day: D(1), value: 90 });
  });
});

describe("meter replacement", () => {
  it("closes the old meter and opens the new one in one transaction", async () => {
    const eq = await equipmentFixture("Replace", "hours", (await operationFixture("Replace")).operation.id);
    must(await record(eq, D(1), 100));
    must(await record(eq, D(3), 150));
    const done = must(await replace(eq, D(4), 160, 0));
    expect(done.closed.kind).toBe("replacement_close");
    expect(done.opened.kind).toBe("replacement_open");
    expect(await meterRows(eq)).toEqual([
      { kind: "hours", opened_on: D(1), closed_on: D(4), initial_value_tenths: 1000 },
      { kind: "hours", opened_on: D(4), closed_on: null, initial_value_tenths: 0 },
    ]);
    must(await record(eq, D(5), 10));
    expect(code(await record(eq, D(3), 155))).toBe("reading_out_of_order");
    const [entry] = await audits(eq, "metering.meter.replace");
    expect(entry?.reason).toBe("Meter broke");
    expect(entry?.entity_type).toBe("meter");
    await expectConsistent(eq);
  });

  it("refuses a day before the last reading, a lower final value, a missing reason and an equipment without meter", async () => {
    const org = await operationFixture("ReplaceRules");
    const eq = await equipmentFixture("ReplaceRules", "hours", org.operation.id);
    expect(code(await replace(eq, D(1), 10, 0))).toBe("meter_replacement_invalid");
    must(await record(eq, D(3), 100));
    expect(code(await replace(eq, D(2), 100, 0))).toBe("meter_replacement_invalid");
    expect(code(await replace(eq, D(3), 99.9, 0))).toBe("meter_replacement_invalid");
    expect(code(await replace(eq, D(3), 100, 0, " "))).toBe("reason_required");
    expect(await meterRows(eq)).toHaveLength(1);
    const none = await equipmentFixture("ReplaceNone", "none", org.operation.id);
    expect(code(await replace(none, D(1), 1, 0))).toBe("no_meter");
  });

  it("rolls both meters and all readings back when the audit entry fails", async () => {
    const eq = await equipmentFixture("ReplaceFail", "hours", (await operationFixture("ReplaceFail")).operation.id);
    must(await record(eq, D(1), 100));
    const broken = createContainer(app, {
      hasher,
      wrapAudit: (inner) => ({ record: (entry) => (entry.action === "metering.meter.replace" ? Promise.reject(new Error("boom")) : inner.record(entry)) }),
    });
    await expect(replace(eq, D(2), 120, 0, "Meter broke", broken)).rejects.toThrow("boom");
    expect(await meterRows(eq)).toEqual([{ kind: "hours", opened_on: D(1), closed_on: null, initial_value_tenths: 1000 }]);
    expect((await readingRows(eq)).map((r) => r.kind)).toEqual(["reading"]);
  });

  it("sums the hours of the last 30 days across a replacement", async () => {
    const eq = await equipmentFixture("Hours", "hours", (await operationFixture("Hours")).operation.id);
    const back = (days: number): string => shiftDay(today(), -days);
    must(await record(eq, back(20), 100));
    must(await record(eq, back(10), 150));
    must(await replace(eq, back(5), 160, 0));
    must(await record(eq, back(1), 30));
    const listed = must(await list(eq));
    expect(listed.hoursLast30Days).toEqual({ hours: 90, incomplete: false });
    expect(listed.meter?.initialValueTenths).toBe(0);
    expect(listed.meterKind).toBe("hours");
    expect(listed.history).toHaveLength(5);
  });
});

describe("scoped reads and writes", () => {
  it("lets a supervisor and a manager read what their scope covers, and nobody but the fleet roles write", async () => {
    const inside = await operationFixture("ScopeIn");
    const outside = await operationFixture("ScopeOut");
    const eq = await equipmentFixture("ScopeIn", "hours", inside.operation.id);
    const far = await equipmentFixture("ScopeFar", "hours", outside.operation.id);
    const loose = await equipmentFixture("ScopeLoose");
    const supervisor = await scopedStaff(`sup-${next()}@example.test`, "supervisor", { type: "operation", id: inside.operation.id });
    const manager = await scopedStaff(`mgr-${next()}@example.test`, "manager");
    const first = must(await record(eq, D(1), 10));
    must(await record(far, D(1), 10));
    must(await record(loose, D(1), 10));
    expect(must(await list(eq, supervisor)).history).toHaveLength(1);
    expect(code(await list(far, supervisor))).toBe("not_found");
    expect(code(await list(loose, supervisor))).toBe("not_found");
    expect(code(await list(randomUUID(), supervisor))).toBe("not_found");
    expect(code(await list("not-a-uuid", supervisor))).toBe("not_found");
    expect(must(await list(far, manager)).history).toHaveLength(1);
    expect(must(await list(loose, manager)).history).toHaveLength(1);
    expect(code(await record(eq, D(2), 20, supervisor))).toBe("forbidden");
    expect(code(await record(eq, D(2), 20, manager))).toBe("forbidden");
    expect(code(await correct(eq, first.id, 5, "Typing mistake", supervisor))).toBe("forbidden");
    expect(code(await c.metering.replaceMeter.execute({ actor: manager, equipmentId: eq, day: D(2), finalValue: 20, initialValue: 0, reason: "Broke" }))).toBe("forbidden");
    expect(await readingRows(eq)).toHaveLength(1);
    expect(code(await record(far, D(2), 20, supervisor))).toBe("not_found");
    expect(code(await record(far, D(2), 20, manager))).toBe("forbidden");
  });

  it("lets a fleet analyst scoped to an operation write there and not elsewhere", async () => {
    const inside = await operationFixture("AnalystIn");
    const outside = await operationFixture("AnalystOut");
    const eq = await equipmentFixture("AnalystIn", "hours", inside.operation.id);
    const far = await equipmentFixture("AnalystFar", "hours", outside.operation.id);
    const scoped = await scopedStaff(`ana-${next()}@example.test`, "fleet_analyst", { type: "operation", id: inside.operation.id });
    must(await record(eq, D(1), 10, scoped));
    expect(code(await record(far, D(1), 10, scoped))).toBe("not_found");
  });
});

describe("PostgresEquipmentDirectory", () => {
  const inTx = <T>(work: (handle: TransactionSql) => Promise<T>): Promise<T> =>
    app.begin((handle) => work(handle)) as Promise<T>;

  it("answers the meter kind, the archived flag and the position of the OPEN assignment", async () => {
    const org = await operationFixture("Directory");
    const placed = await equipmentFixture("DirPlaced", "km", org.operation.id);
    const loose = await equipmentFixture("DirLoose", "none");
    const archived = await equipmentFixture("DirArchived", "hours");
    must(await c.fleet.archiveEquipment.execute({ actor: analyst, id: archived, reason: "Baja" }));
    const tenantId = adminActor.tenantId;
    const found = await inTx(async (h) => {
      const dir = new PostgresEquipmentDirectory(h);
      return [
        await dir.find(tenantId, placed, { lock: false }),
        await dir.find(tenantId, loose, { lock: false }),
        await dir.find(tenantId, archived, { lock: false }),
      ];
    });
    expect(found[0]).toEqual({
      id: placed, meterKind: "km", archived: false,
      position: { tenantId, businessUnitId: org.division.id, operationId: org.operation.id, siteId: org.site.id },
    });
    expect(found[1]).toEqual({ id: loose, meterKind: "none", archived: false, position: null });
    expect(found[2]).toMatchObject({ id: archived, archived: true, position: null });
  });

  it("answers the position of the new open assignment after a move, not the ended one", async () => {
    const first = await operationFixture("DirMoveA");
    const second = await operationFixture("DirMoveB");
    const eq = await equipmentFixture("DirMove", "hours", first.operation.id);
    must(await c.fleet.moveEquipment.execute({ actor: adminActor, equipmentId: eq, operationId: second.operation.id, day: shiftDay(today(), 1), reason: "Reassigned" }));
    const info = await inTx((h) => new PostgresEquipmentDirectory(h).find(adminActor.tenantId, eq, { lock: false }));
    expect(info?.position?.operationId).toBe(second.operation.id);
  });

  it("answers null for a missing equipment, one of another tenant and a malformed id, the last without a query", async () => {
    const eq = await equipmentFixture("DirNull");
    const [tenant] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Dir Tenant') returning id`;
    const noQuery = new PostgresEquipmentDirectory((() => {
      throw new Error("must not query");
    }) as unknown as TransactionSql);
    expect(await noQuery.find(adminActor.tenantId, "not-a-uuid", { lock: true })).toBeNull();
    expect(await noQuery.find("nope", eq, { lock: false })).toBeNull();
    const rows = await inTx(async (h) => {
      const dir = new PostgresEquipmentDirectory(h);
      return [await dir.find(adminActor.tenantId, randomUUID(), { lock: true }), await dir.find(tenant?.id ?? "", eq, { lock: true })];
    });
    expect(rows).toEqual([null, null]);
  });

  it("takes FOR NO KEY UPDATE only when asked, and keeps it until the transaction ends", async () => {
    const eq = await equipmentFixture("DirLock");
    const tryLock = () => failure(owner`select 1 from equipments where id = ${eq} for no key update nowait`);
    await inTx(async (h) => {
      const dir = new PostgresEquipmentDirectory(h);
      await dir.find(adminActor.tenantId, eq, { lock: false });
      expect(await tryLock()).toBeNull();
      await dir.find(adminActor.tenantId, eq, { lock: true });
      expect((await tryLock())?.code).toBe("55P03");
    });
    expect(await tryLock()).toBeNull();
  });
});

describe("the initial reading of a new equipment (InitialReadingRecorder)", () => {
  const fleetUnitOfWork = () =>
    new PostgresUnitOfWork(app, (handle) => createPostgresFleetTx(handle, (h) => new PostgresOperationDirectory(h)));
  const input = (equipmentId: string, over: { value?: number; meterKind?: "hours" | "km" | "none" } = {}) => ({
    actor: adminActor, tenantId: adminActor.tenantId, equipmentId, meterKind: over.meterKind ?? "hours", day: D(0),
    value: over.value ?? 12.5, actorRole: "admin",
  });

  it("commits with the caller's transaction: the meter, the reading and the audit entry", async () => {
    const eq = await equipmentFixture("InitialOk");
    const result = await fleetUnitOfWork().run((tx) => c.initialReadingRecorder.record(tx, input(eq)));
    const stored = must(result);
    expect(stored.readingId).toBeTruthy();
    expect(await meterRows(eq)).toEqual([{ kind: "hours", opened_on: D(0), closed_on: null, initial_value_tenths: 125 }]);
    expect((await readingRows(eq)).map((r) => r.value_tenths)).toEqual([125]);
    expect(await audits(eq, "metering.reading.create")).toHaveLength(1);
  });

  it("rolls everything back with the caller's transaction, the audit entry included", async () => {
    const eq = await equipmentFixture("InitialRollback");
    const result = await fleetUnitOfWork().run(async (tx) => {
      const recorded = await c.initialReadingRecorder.record(tx, input(eq));
      return recorded.ok ? err({ code: "later_failure" }) : recorded;
    });
    expect(code(result)).toBe("later_failure");
    expect(await meterRows(eq)).toEqual([]);
    expect(await readingRows(eq)).toEqual([]);
    expect(await audits(eq, "metering.reading.create")).toEqual([]);
  });

  it("returns the typed errors as values: no_meter, invalid value and an actor of another tenant", async () => {
    const eq = await equipmentFixture("InitialErrors");
    const run = (over: Parameters<typeof input>[1]) => fleetUnitOfWork().run((tx) => c.initialReadingRecorder.record(tx, input(eq, over)));
    expect(code(await run({ meterKind: "none" }))).toBe("no_meter");
    expect(code(await run({ value: -1 }))).toBe("invalid_reading_value");
    const foreign = await fleetUnitOfWork().run((tx) => c.initialReadingRecorder.record(tx, { ...input(eq), tenantId: randomUUID() }));
    expect(code(foreign)).toBe("forbidden");
    expect(await meterRows(eq)).toEqual([]);
  });
});

describe("the bounded history", () => {
  it("never loads more than READING_HISTORY_LIMIT readings, and returns the newest ones in order", async () => {
    const extra = 50;
    const eq = await equipmentFixture("Bounded", "hours", (await operationFixture("Bounded")).operation.id);
    must(await record(eq, "2000-01-01", 0));
    const [meter] = await owner<{ id: string }[]>`select id from meters where equipment_id = ${eq}`;
    await owner`
      insert into meter_readings (tenant_id, meter_id, read_on, value_tenths, kind, created_by)
      select ${adminActor.tenantId}, ${meter?.id ?? ""}, date '2000-01-01' + g, g, 'reading', ${adminActor.userId}
      from generate_series(1, ${READING_HISTORY_LIMIT + extra - 1}) g`;
    const total = await owner<{ n: number }[]>`select count(*)::int as n from meter_readings where meter_id = ${meter?.id ?? ""}`;
    expect(total[0]?.n).toBe(READING_HISTORY_LIMIT + extra);
    const listed = must(await list(eq));
    expect(listed.history).toHaveLength(READING_HISTORY_LIMIT);
    expect(listed.history[0]?.value).toBe((READING_HISTORY_LIMIT + extra - 1) / 10);
    expect(listed.history.at(-1)?.value).toBe(extra / 10);
    const seen = await app.begin(async (h) => {
      const rows = await h`select count(*)::int as n from meter_readings where meter_id = ${meter?.id ?? ""}`;
      return rows[0]?.n as number;
    });
    expect(seen).toBeGreaterThan(READING_HISTORY_LIMIT);
  });
});

describe("metering races (real Postgres, several rounds)", () => {
  const rounds = 10;
  const pair = (a: Result<unknown, { code: string }>, b: Result<unknown, { code: string }>): string => `${code(a)}/${code(b)}`;

  it("two concurrent readings that would each pass alone end with an ordered history", async () => {
    for (let round = 0; round < rounds; round += 1) {
      const eq = await equipmentFixture(`RaceReadings${String(round)}`, "hours", (await operationFixture(`RaceReadings${String(round)}`)).operation.id);
      must(await record(eq, D(1), 100));
      must(await record(eq, D(3), 200));
      const [low, high] = await Promise.all([record(eq, D(2), 120), record(eq, D(2), 150)]);
      expect(["ok/ok", "ok/reading_out_of_order", "reading_out_of_order/ok"], pair(low, high)).toContain(pair(low, high));
      expect(await readingRows(eq)).toHaveLength(2 + (code(low) === "ok" ? 1 : 0) + (code(high) === "ok" ? 1 : 0));
      await expectConsistent(eq);
    }
  });

  it("a reading racing a correction ends with an ordered history and exactly one winner", async () => {
    for (let round = 0; round < rounds; round += 1) {
      const eq = await equipmentFixture(`RaceCorrect${String(round)}`, "hours", (await operationFixture(`RaceCorrect${String(round)}`)).operation.id);
      must(await record(eq, D(1), 100));
      const last = must(await record(eq, D(3), 200));
      const [added, fixed] = await Promise.all([record(eq, D(2), 150), correct(eq, last.id, 140)]);
      expect(["ok/reading_out_of_order", "reading_out_of_order/ok"], pair(added, fixed)).toContain(pair(added, fixed));
      await expectConsistent(eq);
    }
  });

  it("a replacement racing a reading never leaves a reading after the closing one", async () => {
    for (let round = 0; round < rounds; round += 1) {
      const eq = await equipmentFixture(`RaceReplace${String(round)}`, "hours", (await operationFixture(`RaceReplace${String(round)}`)).operation.id);
      must(await record(eq, D(1), 100));
      const [replaced, added] = await Promise.all([replace(eq, D(2), 100, 0), record(eq, D(3), 150)]);
      expect(["ok/ok", "meter_replacement_invalid/ok"], pair(replaced, added)).toContain(pair(replaced, added));
      await expectConsistent(eq);
      expect((await meterRows(eq)).filter((m) => m.closed_on === null)).toHaveLength(1);
    }
  });

  it("two concurrent replacements end with one closed meter and one open meter", async () => {
    for (let round = 0; round < rounds; round += 1) {
      const eq = await equipmentFixture(`RaceTwice${String(round)}`, "hours", (await operationFixture(`RaceTwice${String(round)}`)).operation.id);
      must(await record(eq, D(1), 100));
      const [first, second] = await Promise.all([replace(eq, D(2), 120, 0), replace(eq, D(2), 130, 5)]);
      expect(["ok/ok"], pair(first, second)).toContain(pair(first, second));
      expect(await meterRows(eq)).toHaveLength(3);
      await expectConsistent(eq);
    }
  });

  it("a reading racing the archive of its equipment: both orders are consistent, and an accepted reading came first", async () => {
    for (let round = 0; round < rounds; round += 1) {
      const eq = await equipmentFixture(`RaceArchive${String(round)}`, "hours");
      const [added, archived] = await Promise.all([
        record(eq, D(1), 10),
        c.fleet.archiveEquipment.execute({ actor: analyst, id: eq, reason: "Baja" }),
      ]);
      const outcome = pair(added, archived);
      expect(["ok/ok", "equipment_archived/ok"], outcome).toContain(outcome);
      expect(await readingRows(eq)).toHaveLength(code(added) === "ok" ? 1 : 0);
      if (code(added) === "ok") {
        const [reading] = await audits(eq, "metering.reading.create");
        const [archive] = await owner<{ id: string }[]>`select id from audit_log where entity_id = ${eq} and action = 'fleet.archive'`;
        expect(Number(reading?.id)).toBeLessThan(Number(archive?.id));
      }
    }
  });
});
