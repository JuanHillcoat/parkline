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
const NO_OVERLAP = "equipment_assignments_no_overlap";

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
  app = postgres(url.toString(), { max: 8, onnotice: () => undefined, connection: { role: APP_ROLE } });
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

async function staff(email: string, role: Role, scope?: { type: string; id: string }): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  const base = { actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role };
  must(await c.identity.createUser.execute(scope === undefined ? base : { ...base, scope }));
  return signInActor(email);
}

const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const today = (): string => new Date().toISOString().slice(0, 10);

let counter = 0;
const next = (): string => String((counter += 1));

async function parents(label: string) {
  const n = next();
  const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `${label} Supplier ${n}` }));
  const type = must(
    await c.fleet.createAssetType.execute({ actor: adminActor, name: `${label} Type ${n}`, meterKind: "hours", preventiveIntervalHours: 250 }),
  );
  return { supplierId: supplier.id, assetTypeId: type.id, internalCode: `EQ-${n}` };
}

type Parents = Awaited<ReturnType<typeof parents>>;
type Assignment = { operationId: string; kind: string; day: string; reason: string | null };

const createAssigned = (p: Parents, assignment: Assignment | undefined, extra: { actor?: Actor; image?: Uint8Array } = {}) =>
  c.fleet.createEquipment.execute({
    actor: extra.actor ?? adminActor, supplierId: p.supplierId, assetTypeId: p.assetTypeId, internalCode: p.internalCode,
    brand: "Brand", model: "Model", year: null, serialNumber: null, batteryQuantity: null, observations: null,
    ...(assignment === undefined ? {} : { assignment }), ...(extra.image === undefined ? {} : { image: extra.image }),
  });

async function operationFixture(label: string) {
  const n = next();
  const o = c.organization;
  const division = must(await o.createBusinessUnit.execute({ actor: adminActor, name: `${label} Division ${n}` }));
  const site = must(await o.createSite.execute({ actor: adminActor, name: `${label} Site ${n}` }));
  const costCenter = String(2000 + Number(n)).padStart(4, "0");
  const operation = must(
    await o.createOperation.execute({ actor: adminActor, businessUnitId: division.id, siteId: site.id, name: `${label} Operation ${n}`, costCenter }),
  );
  return { division, site, operation };
}

const equipmentsOf = (p: Parents) =>
  owner<{ id: string }[]>`select id from equipments where supplier_id = ${p.supplierId} and internal_code = ${p.internalCode}`;
const assignmentsOf = (equipmentId: string) =>
  owner<{ id: string; operation_id: string; kind: string; reason: string | null; valid_to: string | null; valid_from: string }[]>`
    select id, operation_id, kind, reason, valid_to::text, valid_from::text from equipment_assignments where equipment_id = ${equipmentId}`;
const auditOf = (entityId: string) =>
  owner<{ action: string; reason: string | null; entity_type: string }[]>`
    select action, reason, entity_type from audit_log where entity_id = ${entityId} order by id`;
const orphanAudits = () =>
  owner<{ n: number }[]>`
    select count(*)::int as n from audit_log a
    where a.action = 'fleet.equipment.create' and not exists (select 1 from equipments e where e.id::text = a.entity_id)`;

const jpeg = (marker: number): Uint8Array => {
  const bytes = new Uint8Array(64).fill(marker);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
};

describe("CreateEquipment with an assignment against Postgres", () => {
  it("creates the equipment and an open assignment as parkline_app, with both audit entries", async () => {
    const org = await operationFixture("Born");
    const p = await parents("Born");
    const created = must(await createAssigned(p, { operationId: org.operation.id, kind: "active", day: today(), reason: null }));
    const [row] = await assignmentsOf(created.id);
    expect(row).toMatchObject({ operation_id: org.operation.id, kind: "active", reason: null, valid_to: null, valid_from: today() });
    expect((await auditOf(created.id)).map((e) => e.action)).toEqual(["fleet.equipment.create"]);
    expect(await auditOf(row?.id ?? "")).toMatchObject([{ action: "fleet.assignment.create", entity_type: "equipment_assignment", reason: null }]);
  });

  it("stores a spare assignment from a past day with its reason in the row and in the audit entry", async () => {
    const org = await operationFixture("Past");
    const p = await parents("Past");
    const created = must(await createAssigned(p, { operationId: org.operation.id, kind: "spare", day: "2026-01-05", reason: "Cargado tarde" }));
    const [row] = await assignmentsOf(created.id);
    expect(row).toMatchObject({ kind: "spare", valid_from: "2026-01-05", reason: "Cargado tarde" });
    expect(await auditOf(row?.id ?? "")).toMatchObject([{ action: "fleet.assignment.create", reason: "Cargado tarde" }]);
  });

  it("stores the image together with the assignment", async () => {
    const org = await operationFixture("Img");
    const p = await parents("Img");
    const image = jpeg(9);
    const created = must(await createAssigned(p, { operationId: org.operation.id, kind: "active", day: today(), reason: null }, { image }));
    expect(must(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: created.id })).sha256).toBe(imageHash(image));
    expect(await assignmentsOf(created.id)).toHaveLength(1);
  });

  it("writes no equipment row, image or audit entry when the assignment is refused after the equipment was inserted", async () => {
    const org = await operationFixture("Atomic");
    must(await c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed" }));
    const p = await parents("Atomic");
    const result = await createAssigned(p, { operationId: org.operation.id, kind: "active", day: today(), reason: null }, { image: jpeg(8) });
    expect(code(result)).toBe("operation_archived");
    expect(await equipmentsOf(p)).toHaveLength(0);
    expect(await orphanAudits()).toEqual([{ n: 0 }]);
    const images = await owner<{ n: number }[]>`
      select count(*)::int as n from equipment_images i where not exists (select 1 from equipments e where e.id = i.equipment_id)`;
    expect(images).toEqual([{ n: 0 }]);
    const live = await operationFixture("AtomicOk");
    expect(code(await createAssigned(p, { operationId: live.operation.id, kind: "active", day: today(), reason: null }))).toBe("ok");
  });

  it("rolls back everything for a past day without a reason and for an unknown operation", async () => {
    const org = await operationFixture("Rollback");
    const p = await parents("Rollback");
    expect(code(await createAssigned(p, { operationId: org.operation.id, kind: "active", day: "2025-01-01", reason: null }))).toBe("reason_required");
    const missing = { operationId: "00000000-0000-4000-8000-000000000000", kind: "active", day: today(), reason: null };
    expect(code(await createAssigned(p, missing))).toBe("not_found");
    expect(await equipmentsOf(p)).toHaveLength(0);
    expect(await orphanAudits()).toEqual([{ n: 0 }]);
  });

  it("refuses an actor scoped to another operation and stores nothing", async () => {
    const org = await operationFixture("Scope");
    const other = await operationFixture("ScopeOther");
    const scoped = await staff("scoped@example.test", "fleet_analyst", { type: "operation", id: other.operation.id });
    const p = await parents("Scope");
    const result = await createAssigned(p, { operationId: org.operation.id, kind: "active", day: today(), reason: null }, { actor: scoped });
    expect(code(result)).toBe("forbidden");
    expect(await equipmentsOf(p)).toHaveLength(0);
  });

  it("creates as before without an assignment and leaves the no-overlap exclusion constraint in force", async () => {
    const p = await parents("Plain");
    const created = must(await createAssigned(p, undefined));
    expect(await assignmentsOf(created.id)).toHaveLength(0);
    expect(await owner`select 1 from pg_constraint where conname = ${NO_OVERLAP}`).toHaveLength(1);
    const org = await operationFixture("Plain");
    const assign = () =>
      c.fleet.assignEquipment.execute({ actor: adminActor, equipmentId: created.id, operationId: org.operation.id, kind: "active", day: today() });
    expect(code(await assign())).toBe("ok");
    expect(code(await assign())).toBe("open_assignment_exists");
  });

  it("creates with an assignment and assigns on the same operation at once without deadlock, over several rounds", async () => {
    for (let round = 0; round < 6; round += 1) {
      const org = await operationFixture(`Race ${String(round)}`);
      const other = must(await createAssigned(await parents(`RaceOther ${String(round)}`), undefined));
      const day = today();
      const results = await Promise.all([
        createAssigned(await parents(`RaceNew ${String(round)}`), { operationId: org.operation.id, kind: "active", day, reason: null }),
        c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: other.id, operationId: org.operation.id, kind: "spare", day }),
        createAssigned(await parents(`RaceNew2 ${String(round)}`), { operationId: org.operation.id, kind: "spare", day, reason: null }),
      ]);
      expect(results.map(code)).toEqual(["ok", "ok", "ok"]);
    }
  });

  it("a create with assignment races the archive of its operation: one wins and no equipment is left half done", async () => {
    for (let round = 0; round < 6; round += 1) {
      const org = await operationFixture(`RaceArchive ${String(round)}`);
      const p = await parents(`RaceArchive ${String(round)}`);
      const creating = createAssigned(p, { operationId: org.operation.id, kind: "active", day: today(), reason: null });
      const archiving = c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed" });
      const [created, archived] = await Promise.all([creating, archiving]);
      const pair = `${code(created)}/${code(archived)}`;
      expect(["ok/has_open_assignments", "operation_archived/ok"], pair).toContain(pair);
      expect(await equipmentsOf(p)).toHaveLength(created.ok ? 1 : 0);
      const open = await owner<{ n: number }[]>`
        select count(*)::int as n from equipment_assignments a join operations o on o.id = a.operation_id
        where a.operation_id = ${org.operation.id} and a.valid_to is null and o.archived_at is not null`;
      expect(open).toEqual([{ n: 0 }]);
    }
  });
});
