import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import { PostgresAssignmentDirectory } from "../../src/fleet/infrastructure/postgres-assignment-directory";
import { PostgresAssignmentRepository } from "../../src/fleet/infrastructure/postgres-assignment-repository";
import { PostgresEquipmentRepository } from "../../src/fleet/infrastructure/postgres-fleet-repositories";
import { createPostgresFleetTx } from "../../src/fleet/infrastructure/postgres-fleet-tx";
import { PostgresOperationDirectory } from "../../src/organization/infrastructure/postgres-operation-directory";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import type { AuditLog } from "../../src/shared/domain/ports/audit-log";
import { err, ok, type Result } from "../../src/shared/domain/result";
import { PostgresUnitOfWork } from "../../src/shared/infrastructure/postgres-unit-of-work";
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

async function staff(email: string, role: Role): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role }));
  return signInActor(email);
}

/** A user with one role over one scope (division or operation), signed in. */
async function scopedStaff(email: string, role: Role, scope: { type: string; id: string }): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Scoped", password: PASSWORD, role, scope }));
  return signInActor(email);
}

type PgError = { code?: string; message: string; constraint_name?: string };
const failure = (run: PromiseLike<unknown>): Promise<PgError | null> =>
  Promise.resolve(run).then(
    () => null,
    (error: unknown) => error as PgError,
  );
const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
const today = (): string => new Date().toISOString().slice(0, 10);

let counter = 0;
const next = (): string => String((counter += 1));

/** A supplier, an asset type and one equipment of their own. */
async function equipmentFixture(label: string) {
  const n = next();
  const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `${label} Supplier ${n}` }));
  const type = must(
    await c.fleet.createAssetType.execute({ actor: adminActor, name: `${label} Type ${n}`, meterKind: "hours", preventiveIntervalHours: 250 }),
  );
  return must(
    await c.fleet.createEquipment.execute({
      actor: adminActor, supplierId: supplier.id, assetTypeId: type.id, internalCode: `EQ-${n}`,
      brand: null, model: null, year: null, serialNumber: null, batteryQuantity: null, observations: null,
    }),
  );
}

/** A division, a site and an operation of their own, created through the organization use cases. */
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

type Org = Awaited<ReturnType<typeof operationFixture>>;

type Row = { equipmentId: string; org: Org; from: string; to: string | null; kind?: string };
const insertRow = (handle: Sql | TransactionSql, row: Row) => handle`
  insert into equipment_assignments
    (tenant_id, equipment_id, business_unit_id, operation_id, site_id, kind, valid_from, valid_to, created_by)
  values (${adminActor.tenantId}, ${row.equipmentId}, ${row.org.division.id}, ${row.org.operation.id}, ${row.org.site.id},
          ${row.kind ?? "active"}, ${row.from}::date, ${row.to}::date, ${adminActor.userId})`;

type StoredRow = { valid_from: string; valid_to: string | null; kind: string; operation_id: string; reason: string | null };
const stored = (equipmentId: string) =>
  owner<StoredRow[]>`
    select to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to, kind, operation_id, reason
    from equipment_assignments where equipment_id = ${equipmentId} order by valid_from`;

type AuditRow = { action: string; entity_type: string; reason: string | null; entity_id: string };
const audits = (equipmentId: string) =>
  owner<AuditRow[]>`
    select action, entity_type, reason, entity_id from audit_log
    where entity_id in (select id::text from equipment_assignments where equipment_id = ${equipmentId}) order by id`;

describe("equipment_assignments schema", () => {
  it("has the btree_gist extension and the expected columns", async () => {
    const ext = await owner`select 1 from pg_extension where extname = 'btree_gist'`;
    expect(ext).toHaveLength(1);
    const cols = await owner<{ column_name: string; data_type: string; is_nullable: string }[]>`
      select column_name, data_type, is_nullable from information_schema.columns
      where table_name = 'equipment_assignments' order by ordinal_position`;
    expect(cols.map((col) => col.column_name)).toEqual([
      "id", "tenant_id", "equipment_id", "business_unit_id", "operation_id", "site_id", "kind",
      "valid_from", "valid_to", "reason", "created_by", "created_at",
    ]);
    const type = (name: string) => cols.find((col) => col.column_name === name);
    expect(type("valid_from")).toMatchObject({ data_type: "date", is_nullable: "NO" });
    expect(type("valid_to")).toMatchObject({ data_type: "date", is_nullable: "YES" });
  });

  it("refuses an end before the start and a kind outside active and spare (check constraints)", async () => {
    const org = await operationFixture("Check");
    const eq = await equipmentFixture("Check");
    const backwards = await failure(insertRow(owner, { equipmentId: eq.id, org, from: "2026-03-10", to: "2026-03-09" }));
    expect(backwards?.code).toBe("23514");
    const kind = await failure(insertRow(owner, { equipmentId: eq.id, org, from: "2026-03-10", to: null, kind: "loaned" }));
    expect(kind?.code).toBe("23514");
    expect(await failure(insertRow(owner, { equipmentId: eq.id, org, from: "2026-03-10", to: "2026-03-10" }))).toBeNull();
  });

  it("bounds the reason at 500 characters", async () => {
    const org = await operationFixture("Reason");
    const eq = await equipmentFixture("Reason");
    const withReason = (reason: string) =>
      owner`insert into equipment_assignments (tenant_id, equipment_id, business_unit_id, operation_id, site_id, kind, valid_from, created_by, reason)
            values (${adminActor.tenantId}, ${eq.id}, ${org.division.id}, ${org.operation.id}, ${org.site.id}, 'active', '2026-01-01', ${adminActor.userId}, ${reason})`;
    expect((await failure(withReason("x".repeat(501))))?.code).toBe("23514");
    expect(await failure(withReason("x".repeat(500)))).toBeNull();
  });

  it("refuses a row that points at another tenant, one foreign key at a time (composite keys)", async () => {
    const org = await operationFixture("Tenant");
    const eq = await equipmentFixture("Tenant");
    const [other] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Other Tenant') returning id`;
    const tenant2 = other?.id ?? "";
    const [user2] = await owner<{ id: string }[]>`
      insert into users (id, tenant_id, email, display_name, password_hash) values (${randomUUID()}, ${tenant2}, 'x@example.test', 'X', 'hash') returning id`;
    const [d2] = await owner<{ id: string }[]>`insert into business_units (tenant_id, name) values (${tenant2}, 'DIV2') returning id`;
    const [s2] = await owner<{ id: string }[]>`insert into sites (tenant_id, name) values (${tenant2}, 'SITE2') returning id`;
    const [o2] = await owner<{ id: string }[]>`
      insert into operations (tenant_id, business_unit_id, site_id, name, cost_center) values (${tenant2}, ${d2?.id ?? ""}, ${s2?.id ?? ""}, 'OP2', '0001') returning id`;
    // Everything belongs to tenant 2 except the one reference each case points at tenant 1.
    // The tenant 2 equipment is a stand-in id: a case that keeps it fails on the equipment key instead.
    const [supplier2] = await owner<{ id: string }[]>`insert into suppliers (tenant_id, name) values (${tenant2}, 'SUP2') returning id`;
    const [type2] = await owner<{ id: string }[]>`insert into asset_types (tenant_id, name, meter_kind) values (${tenant2}, 'TYPE2', 'none') returning id`;
    const [eq2] = await owner<{ id: string }[]>`
      insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code) values (${tenant2}, ${supplier2?.id ?? ""}, ${type2?.id ?? ""}, 'EQ2') returning id`;
    const own = { equipment: eq2?.id ?? "", division: d2?.id ?? "", operation: o2?.id ?? "", site: s2?.id ?? "", user: user2?.id ?? "" };
    const attempt = (changes: Partial<typeof own>, year = 2026) => {
      const v = { ...own, ...changes };
      const day = `${String(year)}-01-01`;
      return failure(owner`
        insert into equipment_assignments (tenant_id, equipment_id, business_unit_id, operation_id, site_id, kind, valid_from, valid_to, created_by)
        values (${tenant2}, ${v.equipment}, ${v.division}, ${v.operation}, ${v.site}, 'active', ${day}::date, ${day}::date, ${v.user})`);
    };
    expect(await attempt({})).toBeNull();
    const expected: Record<string, Partial<typeof own>> = {
      equipment_assignments_tenant_id_equipment_id_fkey: { equipment: eq.id },
      equipment_assignments_tenant_id_business_unit_id_fkey: { division: org.division.id },
      equipment_assignments_tenant_id_operation_id_fkey: { operation: org.operation.id },
      equipment_assignments_tenant_id_site_id_fkey: { site: org.site.id },
      equipment_assignments_tenant_id_created_by_fkey: { user: adminActor.userId },
    };
    for (const [constraint, changes] of Object.entries(expected)) {
      // A different year per case, so the valid tenant 2 row above never trips the overlap rule first.
      const error = await attempt(changes, 2030 + Object.keys(expected).indexOf(constraint));
      expect(error?.code, constraint).toBe("23503");
      expect(error?.constraint_name, constraint).toBe(constraint);
    }
  });
});

describe("no-overlap exclusion constraint", () => {
  type Span = readonly [string, string | null];
  const overlap = async (existing: Span, candidate: Span) => {
    const org = await operationFixture("Overlap");
    const eq = await equipmentFixture("Overlap");
    await insertRow(owner, { equipmentId: eq.id, org, from: existing[0], to: existing[1] });
    return { error: await failure(insertRow(owner, { equipmentId: eq.id, org, from: candidate[0], to: candidate[1] })), org };
  };

  it.each([
    ["partially overlapping at the end", ["2026-01-01", "2026-01-31"], ["2026-01-20", "2026-02-10"]],
    ["partially overlapping at the start", ["2026-01-10", "2026-01-31"], ["2026-01-01", "2026-01-10"]],
    ["contained", ["2026-01-01", "2026-01-31"], ["2026-01-10", "2026-01-12"]],
    ["containing", ["2026-01-10", "2026-01-12"], ["2026-01-01", "2026-01-31"]],
    ["a closed period inside an open one", ["2026-01-01", null], ["2026-05-01", "2026-05-31"]],
    ["an open period over a closed one", ["2026-05-01", "2026-05-31"], ["2026-01-01", null]],
    ["two open periods", ["2026-01-01", null], ["2027-01-01", null]],
    ["the same single day", ["2026-01-10", "2026-01-10"], ["2026-01-10", "2026-01-10"]],
  ] as [string, Span, Span][])("refuses %s with 23P01 and the named constraint", async (_name, existing, candidate) => {
    const { error } = await overlap(existing, candidate);
    expect(error?.code).toBe("23P01");
    expect(error?.constraint_name).toBe(NO_OVERLAP);
  });

  it.each([
    ["contiguous: the next day after the end", ["2026-01-01", "2026-01-31"], ["2026-02-01", null]],
    ["contiguous: ends the day before the start", ["2026-02-01", null], ["2026-01-01", "2026-01-31"]],
    ["a gap between two closed periods", ["2026-01-01", "2026-01-10"], ["2026-01-12", "2026-01-20"]],
  ] as [string, Span, Span][])("accepts %s", async (_name, existing, candidate) => {
    expect((await overlap(existing, candidate)).error).toBeNull();
  });

  it("accepts the same days for a different equipment (the rule is per equipment)", async () => {
    const { org } = await overlap(["2026-01-01", null], ["2026-01-01", "2026-01-05"]);
    const other = await equipmentFixture("OtherEq");
    expect(await failure(insertRow(owner, { equipmentId: other.id, org, from: "2026-01-01", to: null }))).toBeNull();
  });

  it("lets an UPDATE that would overlap fail too", async () => {
    const org = await operationFixture("UpdateOverlap");
    const eq = await equipmentFixture("UpdateOverlap");
    await insertRow(owner, { equipmentId: eq.id, org, from: "2026-01-01", to: "2026-01-10" });
    await insertRow(owner, { equipmentId: eq.id, org, from: "2026-01-11", to: null });
    const error = await failure(owner`update equipment_assignments set valid_from = '2026-01-05' where equipment_id = ${eq.id} and valid_to is null`);
    expect(error?.code).toBe("23P01");
  });
});

describe("assignments as parkline_app", () => {
  /** Runs `statement` as the application role in a transaction that is always rolled back. */
  const asApp = async (statement: (tx: TransactionSql) => PromiseLike<unknown>): Promise<PgError | null> => {
    const rollback = new Error("rollback");
    let raised: PgError | null = null;
    try {
      await app.begin(async (tx) => {
        try {
          await tx.savepoint((sp) => statement(sp));
        } catch (error) {
          raised = error as PgError;
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return raised;
  };

  it("holds exactly SELECT, INSERT and UPDATE", async () => {
    const rows = await owner<{ p: string }[]>`
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(${APP_ROLE}, 'equipment_assignments', p) order by p`;
    expect(rows.map((r) => r.p)).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("selects, inserts and updates", async () => {
    const org = await operationFixture("Grant");
    const eq = await equipmentFixture("Grant");
    const error = await asApp(async (tx) => {
      await tx`select count(*) from equipment_assignments`;
      await insertRow(tx, { equipmentId: eq.id, org, from: "2026-01-01", to: null });
      await tx`update equipment_assignments set valid_to = '2026-01-31' where equipment_id = ${eq.id}`;
    });
    expect(error).toBeNull();
  });

  it("refuses DELETE and TRUNCATE with 42501", async () => {
    for (const statement of ["delete from equipment_assignments", "truncate table equipment_assignments"]) {
      const error = await asApp((tx) => tx.unsafe(statement));
      expect(error?.code, statement).toBe("42501");
      expect(error?.message).toMatch(/permission denied for table equipment_assignments/);
    }
  });
});

describe("audit reason trigger for the assignment actions", () => {
  const insertAudit = (action: string, reason: string | null) => owner`
    insert into audit_log (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id, origin, correlation_id, reason)
    values (gen_random_uuid(), 'actor-1', 'user', 'tester', ${action}, 'thing', 'thing-1', 'ui', 'corr-1', ${reason})`;
  const chars = (...points: number[]): string => String.fromCharCode(...points);

  it.each(["fleet.assignment.move", "fleet.assignment.replace", "fleet.assignment.end", "fleet.assignment.correct"])(
    "%s needs a visible reason: null, blank and invisible-only are refused",
    async (action) => {
      for (const reason of [null, "", "  ", chars(0x200b, 0xa0, 0xfeff), chars(0x3000, 0x2060), chars(9, 10, 0x85)]) {
        const error = await failure(insertAudit(action, reason));
        expect(error?.code, JSON.stringify(reason)).toBe("23514");
        expect(error?.message).toBe(`audit action "${action}" requires a non-blank reason`);
      }
      await insertAudit(action, "Documented reason");
    },
  );

  it("keeps fleet.assignment.create free of the rule", async () => {
    await insertAudit("fleet.assignment.create", null);
  });
});

describe("assignment flows through the container as parkline_app", () => {
  const f = () => c.fleet;
  const assign = (equipmentId: string, operationId: string, extra: { kind?: string; day?: string; reason?: string } = {}) =>
    f().assignEquipment.execute({ actor: analyst, equipmentId, operationId, kind: extra.kind ?? "active", day: extra.day ?? today(), reason: extra.reason });

  it("assigns, lists and audits; a past start needs a reason and a bad day is refused", async () => {
    const org = await operationFixture("Assign");
    const eq = await equipmentFixture("Assign");
    expect(code(await assign(eq.id, org.operation.id, { day: "2020-01-01" }))).toBe("reason_required");
    expect(code(await assign(eq.id, org.operation.id, { day: "2026-02-30" }))).toBe("invalid_day");
    expect(await stored(eq.id)).toHaveLength(0);
    const made = must(await assign(eq.id, org.operation.id, { day: "2020-01-01", reason: "Loaded late" }));
    expect(made).toMatchObject({ validFrom: "2020-01-01", validTo: null, kind: "active", siteId: org.site.id, businessUnitId: org.division.id });
    expect(await stored(eq.id)).toEqual([
      { valid_from: "2020-01-01", valid_to: null, kind: "active", operation_id: org.operation.id, reason: "Loaded late" },
    ]);
    expect((await audits(eq.id)).map((e) => e.action)).toEqual(["fleet.assignment.create"]);
    expect(code(await assign(eq.id, org.operation.id))).toBe("open_assignment_exists");
    const listed = must(await f().listEquipmentAssignments.execute({ actor: analyst, equipmentId: eq.id }));
    expect(listed.map((a) => a.validFrom)).toEqual(["2020-01-01"]);
  });

  it("returns days as YYYY-MM-DD strings, never Date objects", async () => {
    const org = await operationFixture("Days");
    const eq = await equipmentFixture("Days");
    must(await assign(eq.id, org.operation.id, { kind: "spare" }));
    const [open] = must(await f().listEquipmentAssignments.execute({ actor: analyst, equipmentId: eq.id }));
    expect(typeof open?.validFrom).toBe("string");
    expect(open?.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(open?.validTo).toBeNull();
  });

  it("moves: closes the day before and opens the new one atomically, with a sensitive audit entry", async () => {
    const [a, b] = [await operationFixture("MoveA"), await operationFixture("MoveB")];
    const eq = await equipmentFixture("Move");
    must(await assign(eq.id, a.operation.id, { day: "2026-01-10", reason: "Backfill" }));
    must(await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: b.operation.id, day: "2026-02-01", reason: "Contract started" }));
    expect((await stored(eq.id)).map((r) => [r.valid_from, r.valid_to, r.operation_id])).toEqual([
      ["2026-01-10", "2026-01-31", a.operation.id],
      ["2026-02-01", null, b.operation.id],
    ]);
    const entries = await audits(eq.id);
    expect(entries.map((e) => e.action)).toEqual(["fleet.assignment.create", "fleet.assignment.move"]);
    expect(entries[1]?.reason).toBe("Contract started");
  });

  it("a move that fails to open the new assignment leaves the old one untouched", async () => {
    const [a, b] = [await operationFixture("AtomicA"), await operationFixture("AtomicB")];
    const eq = await equipmentFixture("Atomic");
    must(await assign(eq.id, a.operation.id, { day: "2026-01-10", reason: "Backfill" }));
    must(await c.organization.archiveOperation.execute({ actor: analyst, id: b.operation.id, reason: "Closed" }));
    const refused = await f().moveEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: b.operation.id, day: "2026-02-01", reason: "Try" });
    expect(code(refused)).toBe("operation_archived");
    expect((await stored(eq.id)).map((r) => [r.valid_from, r.valid_to])).toEqual([["2026-01-10", null]]);
    expect(await audits(eq.id)).toHaveLength(1);
  });

  it("replaces leaving the outgoing one as a spare, in the same operation", async () => {
    const org = await operationFixture("ReplaceSpare");
    const [outgoing, incoming] = [await equipmentFixture("Out"), await equipmentFixture("In")];
    must(await assign(outgoing.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await f().replaceEquipment.execute({
      actor: analyst, incomingEquipmentId: incoming.id, outgoingEquipmentId: outgoing.id, day: "2026-03-01", outgoing: "spare", reason: "New unit",
    }));
    expect((await stored(outgoing.id)).map((r) => [r.valid_from, r.valid_to, r.kind])).toEqual([
      ["2026-01-01", "2026-02-28", "active"],
      ["2026-03-01", null, "spare"],
    ]);
    expect((await stored(incoming.id)).map((r) => [r.valid_from, r.valid_to, r.kind, r.operation_id])).toEqual([
      ["2026-03-01", null, "active", org.operation.id],
    ]);
    const archived = await owner`select archived_at from equipments where id = ${outgoing.id}`;
    expect(archived[0]?.archived_at).toBeNull();
    expect((await audits(incoming.id)).map((e) => e.action)).toEqual(["fleet.assignment.replace"]);
  });

  it("replaces retiring the outgoing one: its assignment ends and the equipment is archived", async () => {
    const org = await operationFixture("ReplaceRetire");
    const [outgoing, incoming] = [await equipmentFixture("OutR"), await equipmentFixture("InR")];
    must(await assign(outgoing.id, org.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await f().replaceEquipment.execute({
      actor: analyst, incomingEquipmentId: incoming.id, outgoingEquipmentId: outgoing.id, day: "2026-03-01", outgoing: "retire", reason: "Supplier withdrew it",
    }));
    expect((await stored(outgoing.id)).map((r) => [r.valid_from, r.valid_to])).toEqual([["2026-01-01", "2026-02-28"]]);
    const archived = await owner`select archived_at from equipments where id = ${outgoing.id}`;
    expect(archived[0]?.archived_at).not.toBeNull();
    const actions = await owner<{ action: string }[]>`select action from audit_log where entity_id = ${outgoing.id} order by id`;
    expect(actions.map((a) => a.action)).toContain("fleet.archive");
  });

  it("gives a scoped reader the supplier and asset type names of its equipment, which it cannot read from the catalogs", async () => {
    const [mine, other] = [await operationFixture("NamesMine"), await operationFixture("NamesOther")];
    const [here, there] = [await equipmentFixture("NamesHere"), await equipmentFixture("NamesThere")];
    must(await assign(here.id, mine.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await assign(there.id, other.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    const n = next();
    const supervisor = await scopedStaff(`supervisor.names${n}@example.test`, "supervisor", { type: "operation", id: mine.operation.id });
    const manager = await scopedStaff(`manager.names${n}@example.test`, "manager", { type: "business_unit", id: mine.division.id });

    const supplierRows = await owner<{ name: string }[]>`select name from suppliers where id = ${here.supplierId}`;
    const typeRows = await owner<{ name: string }[]>`select name from asset_types where id = ${here.assetTypeId}`;
    const [supplierName, typeName] = [supplierRows[0]?.name ?? "", typeRows[0]?.name ?? ""];
    for (const reader of [supervisor, manager]) {
      const rows = must(await c.fleet.listEquipment.execute({ actor: reader }));
      expect(rows.map((row) => row.id)).toEqual([here.id]);
      expect(rows[0]?.supplier).toEqual({ id: here.supplierId, name: supplierName });
      expect(rows[0]?.assetType).toEqual({ id: here.assetTypeId, name: typeName, meterKind: "hours" });
    }
  });

  it("reads one equipment for tenant-wide and scoped readers, an unassigned and an archived one, as parkline_app", async () => {
    const [mine, other] = [await operationFixture("GetMine"), await operationFixture("GetOther")];
    const [here, there, idle, gone] = [
      await equipmentFixture("GetHere"), await equipmentFixture("GetThere"), await equipmentFixture("GetIdle"), await equipmentFixture("GetGone"),
    ];
    must(await assign(here.id, mine.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await assign(there.id, other.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await c.fleet.archiveEquipment.execute({ actor: analyst, id: gone.id, reason: "Loaded by mistake" }));
    const n = next();
    const supervisor = await scopedStaff(`supervisor.get${n}@example.test`, "supervisor", { type: "operation", id: mine.operation.id });
    const manager = await scopedStaff(`manager.get${n}@example.test`, "manager", { type: "business_unit", id: mine.division.id });
    const get = (actor: Actor, id: string) => c.fleet.getEquipment.execute({ actor, id });

    const wide = must(await get(analyst, here.id));
    expect(wide).toMatchObject({ id: here.id, assignment: { operationId: mine.operation.id, siteId: mine.site.id, kind: "active", validFrom: "2026-01-01" } });
    expect(wide.supplier.id).toBe(here.supplierId);
    expect(wide.assetType).toMatchObject({ id: here.assetTypeId, meterKind: "hours" });
    expect(must(await get(analyst, idle.id)).assignment).toBeNull();
    expect(must(await get(analyst, gone.id)).archivedAt).not.toBeNull();
    for (const reader of [supervisor, manager]) {
      expect(must(await get(reader, here.id)).supplier.id).toBe(here.supplierId);
      for (const hidden of [there.id, idle.id, gone.id, randomUUID()]) expect(code(await get(reader, hidden))).toBe("not_found");
    }
    expect(code(await get(analyst, randomUUID()))).toBe("not_found");
  });

  it("ends an open assignment and corrects an existing one; history is newest first", async () => {
    const [a, b] = [await operationFixture("EndA"), await operationFixture("EndB")];
    const eq = await equipmentFixture("End");
    const first = must(await assign(eq.id, a.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await f().endAssignment.execute({ actor: analyst, equipmentId: eq.id, day: "2026-01-31", reason: "Unit parked" }));
    must(await assign(eq.id, b.operation.id, { kind: "spare", day: "2026-03-01", reason: "Back in use" }));
    const fixed = must(await f().correctAssignment.execute({ actor: analyst, assignmentId: first.id, validTo: "2026-02-15", kind: "spare", reason: "Wrong end day" }));
    expect(fixed).toMatchObject({ validTo: "2026-02-15", kind: "spare" });
    const listed = must(await f().listEquipmentAssignments.execute({ actor: analyst, equipmentId: eq.id }));
    expect(listed.map((x) => x.validFrom)).toEqual(["2026-03-01", "2026-01-01"]);
    const overlapping = await f().correctAssignment.execute({ actor: analyst, assignmentId: first.id, validTo: "2026-03-05", reason: "Too long" });
    expect(code(overlapping)).toBe("assignment_overlap");
    expect((await audits(eq.id)).map((e) => e.action)).toEqual([
      "fleet.assignment.create", "fleet.assignment.end", "fleet.assignment.create", "fleet.assignment.correct",
    ]);
  });

  it("an equipment with an open assignment cannot be archived until it is ended", async () => {
    const org = await operationFixture("Block");
    const eq = await equipmentFixture("Block");
    must(await assign(eq.id, org.operation.id));
    expect(code(await f().archiveEquipment.execute({ actor: analyst, id: eq.id, reason: "Baja" }))).toBe("has_open_assignment");
    must(await f().endAssignment.execute({ actor: analyst, equipmentId: eq.id, day: today(), reason: "Done" }));
    must(await f().archiveEquipment.execute({ actor: analyst, id: eq.id, reason: "Baja" }));
    expect(code(await assign(eq.id, org.operation.id))).toBe("archived");
  });

  it("refuses an archived operation, and an operation whose site or division is archived", async () => {
    const eq = await equipmentFixture("Archived");
    const direct = await operationFixture("ArchivedOp");
    must(await c.organization.archiveOperation.execute({ actor: analyst, id: direct.operation.id, reason: "Closed" }));
    expect(code(await assign(eq.id, direct.operation.id))).toBe("operation_archived");
    const viaSite = await operationFixture("ArchivedSite");
    await owner`update sites set archived_at = now() where id = ${viaSite.site.id}`;
    expect(code(await assign(eq.id, viaSite.operation.id))).toBe("operation_archived");
    const viaDivision = await operationFixture("ArchivedDiv");
    await owner`update business_units set archived_at = now() where id = ${viaDivision.division.id}`;
    expect(code(await assign(eq.id, viaDivision.operation.id))).toBe("operation_archived");
    expect(await stored(eq.id)).toHaveLength(0);
  });

  it("isolates tenants in the repository and the operation directory", async () => {
    const org = await operationFixture("Isolation");
    const eq = await equipmentFixture("Isolation");
    const made = must(await assign(eq.id, org.operation.id));
    const [other] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Isolated Tenant') returning id`;
    const tenant2 = other?.id ?? "";
    await app.begin(async (tx) => {
      const repo = new PostgresAssignmentRepository(tx);
      expect(await repo.findById(tenant2, made.id)).toBeNull();
      expect(await repo.findOpen(tenant2, eq.id)).toBeNull();
      expect(await repo.listByEquipment(tenant2, eq.id)).toEqual([]);
      expect(await new PostgresOperationDirectory(tx).find(tenant2, org.operation.id)).toBeNull();
      expect(await new PostgresOperationDirectory(tx).find(adminActor.tenantId, "not-a-uuid")).toBeNull();
      expect(await repo.findById(adminActor.tenantId, made.id)).toMatchObject({ id: made.id, validFrom: made.validFrom });
    });
  });

  it("blocks the archive of an operation with an open assignment until the assignment is ended (D7)", async () => {
    const org = await operationFixture("OrgBlock");
    const eq = await equipmentFixture("OrgBlock");
    must(await assign(eq.id, org.operation.id));
    const blocked = await c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed" });
    expect(code(blocked)).toBe("has_open_assignments");
    const row = await owner`select archived_at from operations where id = ${org.operation.id}`;
    expect(row[0]?.archived_at).toBeNull();
    const none = await owner`select 1 from audit_log where entity_id = ${org.operation.id} and action = 'organization.archive'`;
    expect(none).toHaveLength(0);
    must(await f().endAssignment.execute({ actor: analyst, equipmentId: eq.id, day: today(), reason: "Done" }));
    must(await c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed for good" }));
    const audited = await owner<{ reason: string }[]>`
      select reason from audit_log where entity_id = ${org.operation.id} and action = 'organization.archive'`;
    expect(audited.map((a) => a.reason)).toEqual(["Closed for good"]);
  });

  it("counts only the open assignments of that operation, and restoring an operation is not blocked", async () => {
    const [target, other] = [await operationFixture("OrgCount"), await operationFixture("OrgCountOther")];
    const [moved, kept] = [await equipmentFixture("OrgCountA"), await equipmentFixture("OrgCountB")];
    must(await assign(kept.id, other.operation.id));
    must(await assign(moved.id, target.operation.id, { day: "2026-01-01", reason: "Backfill" }));
    must(await f().endAssignment.execute({ actor: analyst, equipmentId: moved.id, day: "2026-01-31", reason: "Done" }));
    must(await c.organization.archiveOperation.execute({ actor: analyst, id: target.operation.id, reason: "Closed" }));
    expect(code(await c.organization.archiveOperation.execute({ actor: analyst, id: other.operation.id, reason: "Closed" }))).toBe("has_open_assignments");
    must(await c.organization.restoreOperation.execute({ actor: analyst, id: target.operation.id, reason: "Back" }));
    must(await assign(moved.id, target.operation.id, { day: "2026-03-01", reason: "Again" }));
    expect(code(await c.organization.archiveOperation.execute({ actor: analyst, id: target.operation.id, reason: "Closed" }))).toBe("has_open_assignments");
  });

  it("answers a role that may not archive before it counts anything", async () => {
    const org = await operationFixture("OrgAuth");
    const eq = await equipmentFixture("OrgAuth");
    must(await assign(eq.id, org.operation.id));
    expect(code(await c.organization.archiveOperation.execute({ actor: adminActor, id: org.operation.id, reason: "Closed" }))).toBe("forbidden");
  });

  it("counts open assignments for the organization through the fleet adapter, per tenant and per operation", async () => {
    const org = await operationFixture("Directory2");
    const eq = await equipmentFixture("Directory2");
    must(await assign(eq.id, org.operation.id));
    const [other] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Counted Tenant') returning id`;
    await app.begin(async (tx) => {
      const directory = new PostgresAssignmentDirectory(tx);
      expect(await directory.countOpen(adminActor.tenantId, org.operation.id)).toBe(1);
      expect(await directory.countOpen(other?.id ?? "", org.operation.id)).toBe(0);
      expect(await directory.countOpen(adminActor.tenantId, "not-a-uuid")).toBe(0);
      expect(await directory.countOpen("not-a-uuid", org.operation.id)).toBe(0);
      expect(await directory.countOpen(adminActor.tenantId, randomUUID())).toBe(0);
      const repository = new PostgresAssignmentRepository(tx);
      expect((await repository.listOpen(adminActor.tenantId)).map((a) => a.equipmentId)).toContain(eq.id);
      expect(await repository.listOpen(other?.id ?? "")).toEqual([]);
      expect(await repository.listOpen("not-a-uuid")).toEqual([]);
    });
  });

  it("locks equipment rows by id list without failing on duplicates, malformed ids or another tenant", async () => {
    const eq = await equipmentFixture("LockList");
    await app.begin(async (tx) => {
      const equipment = new PostgresEquipmentRepository(tx);
      await equipment.lock(adminActor.tenantId, [eq.id, eq.id.toUpperCase(), "not-a-uuid", randomUUID()]);
      await equipment.lock("not-a-uuid", [eq.id]);
      await equipment.lock(adminActor.tenantId, []);
    });
  });

  it("reports the operation with its parents", async () => {
    const org = await operationFixture("Directory");
    await app.begin(async (tx) => {
      const info = await new PostgresOperationDirectory(tx).find(adminActor.tenantId, org.operation.id);
      expect(info).toEqual({ id: org.operation.id, businessUnitId: org.division.id, siteId: org.site.id, archivedAt: null });
    });
  });

  it("rolls the assignment back when the audit write fails", async () => {
    const org = await operationFixture("Rollback");
    const eq = await equipmentFixture("Rollback");
    const failing: AuditLog = { record: () => Promise.reject(new Error("audit unavailable")) };
    const broken = createContainer(app, { hasher, wrapAudit: () => failing });
    const attempt = broken.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: today() });
    await expect(attempt).rejects.toThrow(/audit unavailable/);
    expect(await stored(eq.id)).toHaveLength(0);
  });

  it("refuses to update an assignment that does not exist instead of reporting it as stored", async () => {
    const org = await operationFixture("Stale");
    const eq = await equipmentFixture("Stale");
    const attempt = app.begin(async (tx) => {
      const { assignments } = createPostgresFleetTx(tx, (handle) => new PostgresOperationDirectory(handle));
      return assignments.update({
        id: randomUUID(), tenantId: adminActor.tenantId, equipmentId: eq.id, businessUnitId: org.division.id,
        operationId: org.operation.id, siteId: org.site.id, kind: "active", validFrom: "2026-01-01", validTo: null,
        reason: null, createdBy: adminActor.userId, createdAt: new Date(),
      });
    });
    await expect(attempt).rejects.toThrow(/missing assignment/);
  });

  it("rolls the first write back when the second write of the same unit of work overlaps", async () => {
    const org = await operationFixture("TwoWrites");
    const eq = await equipmentFixture("TwoWrites");
    must(await assign(eq.id, org.operation.id, { day: "2026-01-10", reason: "Backfill" }));
    const uow = new PostgresUnitOfWork(app, (handle) => createPostgresFleetTx(handle, (h) => new PostgresOperationDirectory(h)));
    const outcome = await uow.run(async (tx) => {
      const open = await tx.assignments.findOpen(adminActor.tenantId, eq.id);
      if (open === null) throw new Error("the fixture has an open assignment");
      const closed = await tx.assignments.update({ ...open, validTo: "2026-03-01" });
      const overlapping = await tx.assignments.add({ ...open, id: randomUUID(), validFrom: "2026-02-01", validTo: null });
      return closed === "stored" && overlapping === "overlap" ? err({ code: "overlap" }) : ok(undefined);
    });
    expect(outcome.ok).toBe(false);
    expect((await stored(eq.id)).map((r) => [r.valid_from, r.valid_to])).toEqual([["2026-01-10", null]]);
  });

  it("creates the three read indexes the repository relies on", async () => {
    const rows = await owner<{ indexname: string }[]>`
      select indexname from pg_indexes where tablename = 'equipment_assignments' order by indexname`;
    const names = rows.map((row) => row.indexname);
    expect(names).toEqual(
      expect.arrayContaining([
        NO_OVERLAP,
        "equipment_assignments_open_idx",
        "equipment_assignments_history_idx",
        "equipment_assignments_operation_idx",
      ]),
    );
  });

  it("rethrows an error that is not the overlap constraint (a foreign key violation)", async () => {
    const org = await operationFixture("Rethrow");
    const attempt = app.begin(async (tx) => {
      const { assignments } = createPostgresFleetTx(tx, (handle) => new PostgresOperationDirectory(handle));
      return assignments.add({
        id: randomUUID(), tenantId: adminActor.tenantId, equipmentId: randomUUID(), businessUnitId: org.division.id,
        operationId: org.operation.id, siteId: org.site.id, kind: "active", validFrom: "2026-01-01", validTo: null,
        reason: null, createdBy: adminActor.userId, createdAt: new Date(),
      });
    });
    await expect(attempt).rejects.toMatchObject({ code: "23503" });
  });
});

describe("assignment races", () => {
  type Attempts = PromiseSettledResult<Result<unknown, { code: string }>>[];
  const outcomes = (attempts: Attempts): string[] =>
    attempts.map((a) => (a.status === "rejected" ? `rejected: ${JSON.stringify(a.reason)}` : code(a.value))).sort();

  /** Waits until some backend of the test database is blocked on a lock. */
  const waitForLockWait = async (): Promise<void> => {
    for (let i = 0; i < 200; i += 1) {
      const rows = await admin`select 1 from pg_stat_activity where datname = ${dbName} and wait_event_type = 'Lock'`;
      if (rows.length > 0) return;
      await sleep(25);
    }
    throw new Error("no backend waited on a lock");
  };

  /** A promise and the function that settles it, for ordering two transactions by hand. */
  const latch = (): { wait: Promise<void>; open: () => void } => {
    let open: () => void = () => undefined;
    const wait = new Promise<void>((done) => (open = done));
    return { wait, open };
  };

  const newAssignment = (equipmentId: string, org: Org, validFrom: string) => ({
    id: randomUUID(), tenantId: adminActor.tenantId, equipmentId, businessUnitId: org.division.id, operationId: org.operation.id,
    siteId: org.site.id, kind: "active" as const, validFrom, validTo: null, reason: null, createdBy: adminActor.userId, createdAt: new Date(),
  });

  const count = async (rows: PromiseLike<{ n: number }[]>): Promise<number> => (await rows)[0]?.n ?? -1;
  const openOnArchivedOperation = (operationId: string) =>
    count(owner<{ n: number }[]>`
      select count(*)::int as n from equipment_assignments a join operations o on o.id = a.operation_id
      where a.operation_id = ${operationId} and a.valid_to is null and o.archived_at is not null`);
  const openOnArchivedEquipment = (equipmentId: string) =>
    count(owner<{ n: number }[]>`
      select count(*)::int as n from equipment_assignments a join equipments e on e.id = a.equipment_id
      where a.equipment_id = ${equipmentId} and a.valid_to is null and e.archived_at is not null`);
  const openCount = (equipmentId: string) =>
    count(owner<{ n: number }[]>`select count(*)::int as n from equipment_assignments where equipment_id = ${equipmentId} and valid_to is null`);

  it("two concurrent assigns of one equipment give one ok and one typed conflict, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const org = await operationFixture(`RaceAssign ${String(round)}`);
      const eq = await equipmentFixture(`RaceAssign ${String(round)}`);
      const run = () => c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: "2026-01-01", reason: "Race" });
      const result = outcomes(await Promise.allSettled([run(), run()])).join(",");
      expect(["assignment_overlap,ok", "ok,open_assignment_exists"], result).toContain(result);
      expect(await stored(eq.id)).toHaveLength(1);
    }
  });

  it("the overlap constraint becomes the typed 'overlap' result when a concurrent transaction took the days first", async () => {
    const org = await operationFixture("RaceRepo");
    const eq = await equipmentFixture("RaceRepo");
    const make = (validFrom: string) => ({
      id: randomUUID(), tenantId: adminActor.tenantId, equipmentId: eq.id, businessUnitId: org.division.id, operationId: org.operation.id,
      siteId: org.site.id, kind: "active" as const, validFrom, validTo: null, reason: null, createdBy: adminActor.userId, createdAt: new Date(),
    });
    const gate = latch();
    const inserted = latch();
    const first = app.begin(async (tx) => {
      const result = await new PostgresAssignmentRepository(tx).add(make("2026-01-01"));
      inserted.open();
      await gate.wait;
      return result;
    });
    await inserted.wait;
    const second = app.begin(async (tx) => new PostgresAssignmentRepository(tx).add(make("2026-06-01")));
    await waitForLockWait();
    gate.open();
    expect(await first).toBe("stored");
    expect(await second).toBe("overlap");
    expect(await stored(eq.id)).toHaveLength(1);
  });

  it("an assign waits for an uncommitted archive of the operation and then refuses it", async () => {
    const org = await operationFixture("LockArchive");
    const eq = await equipmentFixture("LockArchive");
    const gate = latch();
    const updated = latch();
    const archiver = owner.begin(async (tx) => {
      await tx`update operations set archived_at = now() where id = ${org.operation.id}`;
      updated.open();
      await gate.wait;
    });
    await updated.wait;
    const assigning = c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: today() });
    await waitForLockWait();
    gate.open();
    await archiver;
    expect(code(await assigning)).toBe("operation_archived");
    expect(await stored(eq.id)).toHaveLength(0);
  });

  it("an archive of the operation waits for a transaction that holds the shared lock", async () => {
    const org = await operationFixture("LockAssign");
    const gate = latch();
    const locked = latch();
    const holder = app.begin(async (tx) => {
      const info = await new PostgresOperationDirectory(tx).find(adminActor.tenantId, org.operation.id);
      expect(info?.archivedAt).toBeNull();
      locked.open();
      await gate.wait;
    });
    await locked.wait;
    const archiving = c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed" });
    await waitForLockWait();
    gate.open();
    await holder;
    expect(code(await archiving)).toBe("ok");
  });

  it("an assign races the archive of its operation, over several rounds: one wins, never an open assignment on an archived operation", async () => {
    for (let round = 0; round < 8; round += 1) {
      const org = await operationFixture(`RaceArchive ${String(round)}`);
      const eq = await equipmentFixture(`RaceArchive ${String(round)}`);
      const assigning = c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: today() });
      const archiving = c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed" });
      const [assigned, archived] = await Promise.all([assigning, archiving]);
      const pair = `${code(assigned)}/${code(archived)}`;
      expect(["ok/has_open_assignments", "operation_archived/ok"], pair).toContain(pair);
      expect(await stored(eq.id)).toHaveLength(code(assigned) === "ok" ? 1 : 0);
      expect(await openOnArchivedOperation(org.operation.id)).toBe(0);
    }
  });

  it("an archive of the operation waits for an uncommitted assign and then refuses because of its assignment", async () => {
    const org = await operationFixture("LockAssign2");
    const eq = await equipmentFixture("LockAssign2");
    const gate = latch();
    const inserted = latch();
    const holder = app.begin(async (tx) => {
      expect((await new PostgresOperationDirectory(tx).find(adminActor.tenantId, org.operation.id))?.archivedAt).toBeNull();
      const result = await new PostgresAssignmentRepository(tx).add(newAssignment(eq.id, org, "2026-01-01"));
      inserted.open();
      await gate.wait;
      return result;
    });
    await inserted.wait;
    const archiving = c.organization.archiveOperation.execute({ actor: analyst, id: org.operation.id, reason: "Closed" });
    await waitForLockWait();
    gate.open();
    expect(await holder).toBe("stored");
    expect(code(await archiving)).toBe("has_open_assignments");
    expect(await openOnArchivedOperation(org.operation.id)).toBe(0);
  });

  it("an archive of the equipment waits for a transaction that holds its lock and then sees the assignment it stored", async () => {
    const org = await operationFixture("LockEqArchive");
    const eq = await equipmentFixture("LockEqArchive");
    const gate = latch();
    const inserted = latch();
    const holder = app.begin(async (tx) => {
      const result = await new PostgresAssignmentRepository(tx).add(newAssignment(eq.id, org, "2026-01-01"));
      inserted.open();
      await gate.wait;
      return result;
    });
    await inserted.wait;
    const archiving = c.fleet.archiveEquipment.execute({ actor: analyst, id: eq.id, reason: "Baja" });
    await waitForLockWait();
    gate.open();
    expect(await holder).toBe("stored");
    expect(code(await archiving)).toBe("has_open_assignment");
    expect(await openOnArchivedEquipment(eq.id)).toBe(0);
  });

  it("an assign waits for an uncommitted archive of the equipment and then re-reads it as archived", async () => {
    const org = await operationFixture("LockEqAssign");
    const eq = await equipmentFixture("LockEqAssign");
    const gate = latch();
    const updated = latch();
    const archiver = owner.begin(async (tx) => {
      await tx`update equipments set archived_at = now() where id = ${eq.id}`;
      updated.open();
      await gate.wait;
    });
    await updated.wait;
    const assigning = c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: today() });
    await waitForLockWait();
    gate.open();
    await archiver;
    expect(code(await assigning)).toBe("archived");
    expect(await stored(eq.id)).toHaveLength(0);
    expect(await openOnArchivedEquipment(eq.id)).toBe(0);
  });

  /**
   * A writer that holds the equipment lock and has ended the open assignment but not committed yet: the
   * use case under test authorizes, waits for the lock, and must then read what that writer committed.
   */
  const withUncommittedEnd = async (equipmentId: string, run: () => Promise<unknown>): Promise<void> => {
    const gate = latch();
    const updated = latch();
    const holder = owner.begin(async (tx) => {
      await tx`select id from equipments where id = ${equipmentId} for no key update`;
      await tx`update equipment_assignments set valid_to = '2026-02-01'::date where equipment_id = ${equipmentId} and valid_to is null`;
      updated.open();
      await gate.wait;
    });
    await updated.wait;
    const waiting = run();
    await waitForLockWait();
    gate.open();
    await holder;
    await waiting;
  };

  it("an end waits for a writer holding the equipment lock and then finds no open assignment", async () => {
    const org = await operationFixture("LockEnd");
    const eq = await equipmentFixture("LockEnd");
    must(await c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: "2026-01-10", reason: "Backfill" }));
    let answer = "";
    await withUncommittedEnd(eq.id, async () => {
      answer = code(await c.fleet.endAssignment.execute({ actor: analyst, equipmentId: eq.id, day: "2026-03-01", reason: "Fin" }));
    });
    expect(answer).toBe("no_open_assignment");
    expect((await stored(eq.id)).map((r) => [r.valid_from, r.valid_to])).toEqual([["2026-01-10", "2026-02-01"]]);
  });

  it("a move waits for a writer holding the equipment lock and then finds no open assignment", async () => {
    const [a, b] = [await operationFixture("LockMoveA"), await operationFixture("LockMoveB")];
    const eq = await equipmentFixture("LockMove");
    must(await c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: a.operation.id, kind: "active", day: "2026-01-10", reason: "Backfill" }));
    let answer = "";
    await withUncommittedEnd(eq.id, async () => {
      answer = code(await c.fleet.moveEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: b.operation.id, day: "2026-03-01", reason: "Traslado" }));
    });
    expect(answer).toBe("no_open_assignment");
    expect(await stored(eq.id)).toHaveLength(1);
  });

  it("a correction waits for a writer holding the equipment lock and keeps what that writer committed (no lost update)", async () => {
    const org = await operationFixture("LockCorrect");
    const eq = await equipmentFixture("LockCorrect");
    const first = must(await c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: "2026-01-10", reason: "Backfill" }));
    let answer = "";
    await withUncommittedEnd(eq.id, async () => {
      answer = code(await c.fleet.correctAssignment.execute({ actor: analyst, assignmentId: first.id, reason: "Inicio", validFrom: "2026-01-12" }));
    });
    expect(answer).toBe("ok");
    expect((await stored(eq.id)).map((r) => [r.valid_from, r.valid_to])).toEqual([["2026-01-12", "2026-02-01"]]);
  });

  it("an assign races the archive of its equipment, over several rounds: never an open assignment on an archived equipment", async () => {
    for (let round = 0; round < 8; round += 1) {
      const org = await operationFixture(`RaceEqArchive ${String(round)}`);
      const eq = await equipmentFixture(`RaceEqArchive ${String(round)}`);
      const assigning = c.fleet.assignEquipment.execute({ actor: analyst, equipmentId: eq.id, operationId: org.operation.id, kind: "active", day: today() });
      const archiving = c.fleet.archiveEquipment.execute({ actor: analyst, id: eq.id, reason: "Baja" });
      const [assigned, archived] = await Promise.all([assigning, archiving]);
      const pair = `${code(assigned)}/${code(archived)}`;
      expect(["ok/has_open_assignment", "archived/ok"], pair).toContain(pair);
      expect(await stored(eq.id)).toHaveLength(code(assigned) === "ok" ? 1 : 0);
      expect(await openOnArchivedEquipment(eq.id)).toBe(0);
    }
  });

  it("two replaces that swap the same pair of equipment never deadlock and never leave half a change, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const org = await operationFixture(`Swap ${String(round)}`);
      const [first, second] = [await equipmentFixture(`SwapA ${String(round)}`), await equipmentFixture(`SwapB ${String(round)}`)];
      const place = (equipmentId: string) =>
        c.fleet.assignEquipment.execute({ actor: analyst, equipmentId, operationId: org.operation.id, kind: "active", day: "2026-01-01", reason: "Backfill" });
      must(await place(first.id));
      if (round % 2 === 1) must(await place(second.id));
      const replace = (outgoing: string, incoming: string) =>
        c.fleet.replaceEquipment.execute({ actor: analyst, incomingEquipmentId: incoming, outgoingEquipmentId: outgoing, day: "2026-03-01", outgoing: "spare", reason: "Swap" });
      const rowsBefore = (await stored(first.id)).length + (await stored(second.id)).length;
      const results = outcomes(await Promise.allSettled([replace(first.id, second.id), replace(second.id, first.id)]));
      for (const result of results) expect(result, results.join(",")).toMatch(/^(ok|open_assignment_exists|no_open_assignment|assignment_overlap)$/);
      expect(results.filter((r) => r === "ok").length).toBeLessThanOrEqual(1);
      for (const id of [first.id, second.id]) expect(await openCount(id)).toBeLessThanOrEqual(1);
      const rowsAfter = (await stored(first.id)).length + (await stored(second.id)).length;
      expect(rowsAfter, results.join(",")).toBe(rowsBefore + (results.includes("ok") ? 2 : 0));
    }
  });
});
