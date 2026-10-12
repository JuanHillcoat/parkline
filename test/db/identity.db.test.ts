import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";

const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;

function urlFor(database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

let admin: Sql;
let sql: Sql;
let appliedFirstRun: string[];

async function addTenant(name: string): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into tenants (id, name) values (gen_random_uuid(), ${name}) returning id`;
  return rows[0]?.id ?? "";
}

async function addUser(tenantId: string, email: string, displayName = "Synthetic User") {
  const rows = await sql<{ id: string }[]>`
    insert into users (id, tenant_id, email, display_name, password_hash)
    values (gen_random_uuid(), ${tenantId}, ${email}, ${displayName}, 'scrypt$hash')
    returning id`;
  return rows[0]?.id ?? "";
}

async function addAssignment(
  tenantId: string,
  userId: string,
  role: string,
  scopeType: string,
  scopeId: string,
  active = true,
): Promise<void> {
  await sql`
    insert into user_role_assignments
      (id, tenant_id, user_id, role, scope_type, scope_id, active)
    values
      (gen_random_uuid(), ${tenantId}, ${userId}, ${role}, ${scopeType}, ${scopeId}, ${active})`;
}

async function addSession(tenantId: string, userId: string, tokenHash: string): Promise<void> {
  await sql`
    insert into sessions (id, tenant_id, user_id, token_hash, expires_at)
    values (gen_random_uuid(), ${tenantId}, ${userId}, ${tokenHash}, now() + interval '1 day')`;
}

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  sql = postgres(urlFor(dbName), { max: 1, onnotice: () => undefined });
  appliedFirstRun = await migrate(sql, MIGRATIONS_DIR);
});

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`drop database if exists ${dbName}`);
  await admin.end();
});

describe("identity schema after migrations", () => {
  it("applies 0002_identity.sql", () => {
    expect(appliedFirstRun).toContain("0002_identity.sql");
  });

  it("creates identity tables and leaves them empty (no seed)", async () => {
    for (const table of ["tenants", "users", "user_role_assignments", "sessions"]) {
      const rows = await sql.unsafe(`select count(*)::int as n from ${table}`);
      expect(rows[0]?.n, table).toBe(0);
    }
  });
});

describe("users", () => {
  it("allows the same email in two tenants and rejects it twice in one", async () => {
    const a = await addTenant("Tenant A");
    const b = await addTenant("Tenant B");
    await addUser(a, "ana@example.test");
    await addUser(b, "ana@example.test");
    await expect(addUser(a, "ana@example.test")).rejects.toThrow(/duplicate key/);
  });

  it("rejects uppercase, padded and blank values", async () => {
    const t = await addTenant("Tenant C");
    await expect(addUser(t, "Ana@Example.test")).rejects.toThrow(/check/);
    await expect(addUser(t, " ana2@example.test ")).rejects.toThrow(/check/);
    await expect(addUser(t, "")).rejects.toThrow(/check/);
    await expect(addUser(t, "blank@example.test", "   ")).rejects.toThrow(/check/);
  });

  it("rejects a user that references a missing tenant", async () => {
    await expect(addUser("00000000-0000-4000-8000-000000000000", "x@example.test")).rejects.toThrow(
      /foreign key/,
    );
  });
});

describe("user_role_assignments", () => {
  it("rejects an assignment whose tenant differs from the user's tenant", async () => {
    const a = await addTenant("Tenant D");
    const b = await addTenant("Tenant E");
    const userA = await addUser(a, "dora@example.test");
    await expect(addAssignment(b, userA, "viewer", "tenant", b)).rejects.toThrow(/foreign key/);
  });

  it("accepts a valid tenant-scoped admin and a site-scoped supervisor", async () => {
    const t = await addTenant("Tenant F");
    const u = await addUser(t, "fer@example.test");
    await addAssignment(t, u, "admin", "tenant", t);
    await addAssignment(t, u, "supervisor", "site", "site-1");
    const rows = await sql`select count(*)::int as n from user_role_assignments where user_id = ${u}`;
    expect(rows[0]?.n).toBe(2);
  });

  it("requires a tenant-scoped assignment to point at its own tenant", async () => {
    const a = await addTenant("Tenant M");
    const b = await addTenant("Tenant N");
    const u = await addUser(a, "mia@example.test");
    await expect(addAssignment(a, u, "viewer", "tenant", b)).rejects.toThrow(/check/);
    await expect(addAssignment(a, u, "admin", "tenant", b)).rejects.toThrow(/check/);
    await addAssignment(a, u, "viewer", "tenant", a);
    await addAssignment(a, u, "viewer", "site", "arbitrary-site-id");
    const rows = await sql`select count(*)::int as n from user_role_assignments where user_id = ${u}`;
    expect(rows[0]?.n).toBe(2);
  });

  it("rejects admin with a non-tenant scope", async () => {
    const t = await addTenant("Tenant G");
    const u = await addUser(t, "gus@example.test");
    await expect(addAssignment(t, u, "admin", "site", "site-1")).rejects.toThrow(/check/);
  });

  it("rejects an invalid role or scope_type", async () => {
    const t = await addTenant("Tenant H");
    const u = await addUser(t, "hal@example.test");
    await expect(addAssignment(t, u, "owner", "tenant", t)).rejects.toThrow(/check/);
    await expect(addAssignment(t, u, "viewer", "planet", "x")).rejects.toThrow(/check/);
  });

  it("rejects a duplicate active assignment but allows a deactivated duplicate", async () => {
    const t = await addTenant("Tenant I");
    const u = await addUser(t, "ivy@example.test");
    await addAssignment(t, u, "manager", "operation", "op-1");
    await expect(addAssignment(t, u, "manager", "operation", "op-1")).rejects.toThrow(
      /duplicate key/,
    );
    await addAssignment(t, u, "manager", "operation", "op-1", false);
    await addAssignment(t, u, "manager", "operation", "op-1", false);
    const rows = await sql`select count(*)::int as n from user_role_assignments where user_id = ${u}`;
    expect(rows[0]?.n).toBe(3);
  });
});

describe("sessions", () => {
  it("rejects a session whose tenant differs from the user's tenant", async () => {
    const a = await addTenant("Tenant J");
    const b = await addTenant("Tenant K");
    const userA = await addUser(a, "jon@example.test");
    await expect(addSession(b, userA, "hash-cross")).rejects.toThrow(/foreign key/);
  });

  it("enforces a unique token_hash", async () => {
    const t = await addTenant("Tenant L");
    const u = await addUser(t, "lia@example.test");
    await addSession(t, u, "hash-unique");
    await expect(addSession(t, u, "hash-unique")).rejects.toThrow(/duplicate key/);
  });

  it("has no column that could hold the clear token", async () => {
    const cols = await sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'sessions'`;
    expect(cols.map((c) => c.column_name)).not.toContain("token");
  });
});

describe("foreign key delete behavior", () => {
  it("rejects deleting a user that has role assignments", async () => {
    const t = await addTenant("Tenant O");
    const u = await addUser(t, "olo@example.test");
    await addAssignment(t, u, "viewer", "tenant", t);
    await expect(sql`delete from users where id = ${u}`).rejects.toThrow(/foreign key/);
  });

  it("rejects deleting a user that has sessions", async () => {
    const t = await addTenant("Tenant P");
    const u = await addUser(t, "pia@example.test");
    await addSession(t, u, "hash-delete-user");
    await expect(sql`delete from users where id = ${u}`).rejects.toThrow(/foreign key/);
  });

  it("rejects deleting a tenant that has users", async () => {
    const t = await addTenant("Tenant Q");
    await addUser(t, "quin@example.test");
    await expect(sql`delete from tenants where id = ${t}`).rejects.toThrow(/foreign key/);
  });

  it("defines no cascading or nulling deletes on identity foreign keys", async () => {
    const rows = await sql<{ conname: string; confdeltype: string }[]>`
      select conname, confdeltype from pg_constraint
      where contype = 'f'
        and conrelid in ('users'::regclass, 'user_role_assignments'::regclass, 'sessions'::regclass)`;
    expect(rows.length).toBe(3);
    for (const row of rows) expect(row.confdeltype, row.conname).toBe("a");
  });
});

describe("audit_log for identity events", () => {
  async function insertIdentityAudit(): Promise<void> {
    await sql`
      insert into audit_log
        (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id,
         operation_id, origin, correlation_id)
      values
        (gen_random_uuid(), 'actor-1', 'user', 'admin', 'auth.sign_in', 'session', 's-1',
         null, 'ui', 'corr-1')`;
  }

  it("accepts a row with operation_id NULL", async () => {
    await insertIdentityAudit();
    const rows = await sql`select count(*)::int as n from audit_log where operation_id is null`;
    expect(rows[0]?.n).toBe(1);
  });

  it("keeps audit_log tenant_id as uuid and still not null", async () => {
    const rows = await sql<{ data_type: string; is_nullable: string }[]>`
      select data_type, is_nullable from information_schema.columns
      where table_name = 'audit_log' and column_name = 'tenant_id'`;
    expect(rows[0]).toEqual({ data_type: "uuid", is_nullable: "NO" });
  });

  it("still rejects UPDATE and DELETE", async () => {
    await insertIdentityAudit();
    await expect(sql`update audit_log set reason = 'x'`).rejects.toThrow(/append-only/);
    await expect(sql`delete from audit_log`).rejects.toThrow(/append-only/);
  });
});

describe("migration runner with identity", () => {
  it("is idempotent: a second run applies nothing", async () => {
    expect(await migrate(sql, MIGRATIONS_DIR)).toEqual([]);
  });
});
