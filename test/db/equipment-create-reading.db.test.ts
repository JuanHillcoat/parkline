import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import { imageHash } from "../../src/shared/domain/image";
import type { Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";

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

async function staff(email: string, role: Role): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role }));
  return signInActor(email);
}

const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const today = (): string => new Date().toISOString().slice(0, 10);
const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

let counter = 0;
const next = (): string => String((counter += 1));

async function parents(label: string, meterKind: "hours" | "km" | "none" = "hours") {
  const n = next();
  const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `${label} Supplier ${n}` }));
  const type = must(
    await c.fleet.createAssetType.execute({ actor: adminActor, name: `${label} Type ${n}`, meterKind, preventiveIntervalHours: null }),
  );
  return { supplierId: supplier.id, assetTypeId: type.id, internalCode: `EQ-${n}` };
}

type Parents = Awaited<ReturnType<typeof parents>>;
type Assignment = { target: { operationId: string } | { siteId: string }; day: string; reason: string | null };
type Extra = { image?: Uint8Array; assignment?: Assignment; reading?: { day: string; value: number } };

const register = (p: Parents, extra: Extra = {}) =>
  c.fleet.createEquipment.execute({
    actor: adminActor, supplierId: p.supplierId, assetTypeId: p.assetTypeId, internalCode: p.internalCode,
    brand: "Brand", model: "Model", year: null, serialNumber: null, batteryKind: "combustion", batteryQuantity: null, observations: null,
    ...(extra.assignment === undefined ? {} : { assignment: extra.assignment }),
    ...(extra.image === undefined ? {} : { image: extra.image }),
    ...(extra.reading === undefined ? {} : { initialReading: extra.reading }),
  });

async function operationFixture(label: string) {
  const n = next();
  const o = c.organization;
  const division = must(await o.createBusinessUnit.execute({ actor: adminActor, name: `${label} Division ${n}` }));
  const site = must(await o.createSite.execute({ actor: adminActor, name: `${label} Site ${n}` }));
  const costCenter = String(5000 + Number(n)).padStart(4, "0");
  return must(
    await o.createOperation.execute({ actor: adminActor, businessUnitId: division.id, siteId: site.id, name: `${label} Operation ${n}`, costCenter }),
  );
}

const equipmentsOf = (p: Parents) =>
  owner<{ id: string }[]>`select id from equipments where supplier_id = ${p.supplierId} and internal_code = ${p.internalCode}`;
const metersOf = (equipmentId: string) =>
  owner<{ kind: string; opened_on: string; initial_value_tenths: number }[]>`
    select kind, to_char(opened_on, 'YYYY-MM-DD') as opened_on, initial_value_tenths from meters where equipment_id = ${equipmentId}`;
const readingsOf = (equipmentId: string) =>
  owner<{ kind: string; value_tenths: number; read_on: string }[]>`
    select r.kind, r.value_tenths, to_char(r.read_on, 'YYYY-MM-DD') as read_on
    from meter_readings r join meters m on m.tenant_id = r.tenant_id and m.id = r.meter_id where m.equipment_id = ${equipmentId}`;
const auditActions = async (equipmentId: string) =>
  (await owner<{ action: string }[]>`select action from audit_log where subject_equipment_id = ${equipmentId} or entity_id = ${equipmentId} order by id`).map((r) => r.action);
const totals = async () => {
  const [row] = await owner<{ meters: number; readings: number; creates: number; readingAudits: number }[]>`
    select (select count(*)::int from meters) as meters, (select count(*)::int from meter_readings) as readings,
      (select count(*)::int from audit_log where action = 'fleet.equipment.create') as creates,
      (select count(*)::int from audit_log where action = 'metering.reading.create') as "readingAudits"`;
  return row;
};

describe("CreateEquipment with an initial reading against Postgres", () => {
  it("stores the equipment, the assignment, the meter, the first reading and the three audit entries as parkline_app", async () => {
    const op = await operationFixture("Born");
    const p = await parents("Born");
    const assignment = { target: { operationId: op.id }, day: today(), reason: null };
    const created = must(await register(p, { assignment, reading: { day: today(), value: 1234.5 } }));
    expect(await metersOf(created.id)).toEqual([{ kind: "hours", opened_on: today(), initial_value_tenths: 12345 }]);
    expect(await readingsOf(created.id)).toEqual([{ kind: "reading", value_tenths: 12345, read_on: today() }]);
    expect(await auditActions(created.id)).toEqual(["metering.reading.create", "fleet.equipment.create", "fleet.assignment.create"]);
    const listed = must(await c.metering.listEquipmentReadings.execute({ actor: adminActor, equipmentId: created.id }));
    expect(listed.lastReading).toMatchObject({ value: 1234.5, readOn: today() });
  });

  it("stores the image and the reading together without an assignment, and a km meter for a km type", async () => {
    const p = await parents("Km", "km");
    const bytes = new Uint8Array(64).fill(3);
    bytes.set([0xff, 0xd8, 0xff]);
    const created = must(await register(p, { image: bytes, reading: { day: today(), value: 10 } }));
    expect(await metersOf(created.id)).toMatchObject([{ kind: "km" }]);
    expect(must(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: created.id })).sha256).toBe(imageHash(bytes));
  });

  it("without a reading creates no meter and behaves as before", async () => {
    const created = must(await register(await parents("Plain")));
    expect(await metersOf(created.id)).toHaveLength(0);
    expect(await auditActions(created.id)).toEqual(["fleet.equipment.create"]);
  });

  describe.each([
    ["a future day", "hours", () => ({ day: tomorrow(), value: 5 }), "reading_in_future"],
    ["an asset type without a meter", "none", () => ({ day: today(), value: 5 }), "no_meter"],
    ["a value with two decimals", "hours", () => ({ day: today(), value: 1.25 }), "invalid_reading_value"],
    ["an empty day", "hours", () => ({ day: "", value: 5 }), "invalid_day"],
  ] as const)("refuses %s", (_name, kind, reading, expected) => {
    it("leaves no equipment, no assignment, no meter and no audit entry", async () => {
      const op = await operationFixture("Refused");
      const p = await parents("Refused", kind);
      const before = await totals();
      const assignment = { target: { operationId: op.id }, day: today(), reason: null };
      expect(code(await register(p, { assignment, reading: reading() }))).toBe(expected);
      expect(await equipmentsOf(p)).toHaveLength(0);
      expect(await totals()).toEqual(before);
      const [open] = await owner<{ n: number }[]>`select count(*)::int as n from equipment_assignments where operation_id = ${op.id}`;
      expect(open?.n).toBe(0);
    });
  });

  it("registers with an assignment and a reading, assigns another equipment and loads a reading at once without deadlock", async () => {
    for (let round = 0; round < 5; round += 1) {
      const op = await operationFixture(`Race ${String(round)}`);
      const other = must(await register(await parents(`RaceOther ${String(round)}`)));
      const day = today();
      const results = await Promise.all([
        register(await parents(`RaceNew ${String(round)}`), { assignment: { target: { operationId: op.id }, day, reason: null }, reading: { day, value: 7 } }),
        c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: other.id, target: { operationId: op.id }, day }),
        register(await parents(`RaceNew2 ${String(round)}`), { assignment: { target: { operationId: op.id }, day, reason: null }, reading: { day, value: 9 } }),
        c.metering.recordReading.execute({ actor: adminActor, equipmentId: other.id, day, value: 3 }),
      ]);
      expect(results.map(code)).toEqual(["ok", "ok", "ok", "ok"]);
    }
  });
});
