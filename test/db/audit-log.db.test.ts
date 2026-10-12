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

async function insertAuditRow(): Promise<void> {
  await sql`
    insert into audit_log
      (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id,
       operation_id, origin, correlation_id)
    values
      (gen_random_uuid(), 'actor-1', 'user', 'tester', 'test.action', 'thing', 'thing-1',
       'op-1', 'ui', 'corr-1')
  `;
}

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  sql = postgres(urlFor(dbName), { max: 1, onnotice: () => undefined });
  await migrate(sql, MIGRATIONS_DIR);
});

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`drop database if exists ${dbName}`);
  await admin.end();
});

describe("database after migrations", () => {
  it("starts empty: no rows in any application table", async () => {
    const audit = await sql`select count(*)::int as n from audit_log`;
    const outbox = await sql`select count(*)::int as n from outbox_events`;
    expect(audit[0]?.n).toBe(0);
    expect(outbox[0]?.n).toBe(0);
  });

  it("creates only the expected tables", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' order by table_name
    `;
    expect(rows.map((r) => r.table_name)).toEqual(["audit_log", "outbox_events", "schema_migrations"]);
  });

  it("creates the two audit read indexes", async () => {
    const rows = await sql<{ indexdef: string }[]>`
      select indexdef from pg_indexes where tablename = 'audit_log'
    `;
    const defs = rows.map((r) => r.indexdef);
    expect(
      defs.some((d) => d.includes("(tenant_id, subject_equipment_id, occurred_at DESC)")),
    ).toBe(true);
    expect(defs.some((d) => d.includes("(tenant_id, actor_id, occurred_at DESC)"))).toBe(true);
  });

  it("allows inserting an audit row", async () => {
    await insertAuditRow();
    const rows = await sql`select count(*)::int as n from audit_log`;
    expect(rows[0]?.n).toBe(1);
  });

  it("rejects UPDATE on audit_log", async () => {
    await insertAuditRow();
    await expect(sql`update audit_log set reason = 'tampered'`).rejects.toThrow(/append-only/);
  });

  it("rejects DELETE on audit_log", async () => {
    await insertAuditRow();
    await expect(sql`delete from audit_log`).rejects.toThrow(/append-only/);
  });

  it("rejects TRUNCATE on audit_log", async () => {
    await insertAuditRow();
    await expect(sql`truncate table audit_log`).rejects.toThrow(/append-only/);
  });

  it("rejects invalid enumerated values", async () => {
    await expect(
      sql`insert into audit_log
            (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id,
             operation_id, origin, correlation_id)
          values (gen_random_uuid(), 'a', 'robot', 'r', 'x', 't', 'e', 'o', 'ui', 'c')`,
    ).rejects.toThrow();
  });
});

describe("migration runner", () => {
  it("is idempotent: a second run applies nothing", async () => {
    const applied = await migrate(sql, MIGRATIONS_DIR);
    expect(applied).toEqual([]);
    const rows = await sql`select count(*)::int as n from schema_migrations`;
    expect(rows[0]?.n).toBe(1);
  });
});
