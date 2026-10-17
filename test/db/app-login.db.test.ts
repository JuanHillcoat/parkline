import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppLogin } from "../../scripts/app-login";
import { migrate } from "../../scripts/migrate";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const suffix = randomBytes(5).toString("hex");
const USER = `parkline_test_login_${suffix}`;
// Throwaway values generated at runtime; nothing here is a real secret.
const FIRST = `first-${randomBytes(9).toString("hex")}`;
const SECOND = `second-${randomBytes(9).toString("hex")}`;
const DB = `parkline_test_${suffix}`;

let admin: Sql;
let owner: Sql;
const opened: Sql[] = [];

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${DB}`);
  const url = new URL(adminUrl);
  url.pathname = `/${DB}`;
  owner = postgres(url.toString(), { max: 2, onnotice: () => undefined });
  await migrate(owner, MIGRATIONS_DIR);
});

afterAll(async () => {
  await Promise.all(opened.map((sql) => sql.end()));
  await owner.end();
  await admin.unsafe(`drop database if exists ${DB}`);
  // Roles are cluster-level: the login must not outlive the test.
  await admin.unsafe(`drop role if exists ${USER}`);
  await admin.end();
});

function connectAs(user: string, password: string): Sql {
  const url = new URL(adminUrl);
  url.pathname = `/${DB}`;
  url.username = user;
  url.password = password;
  const sql = postgres(url.toString(), { max: 1, onnotice: () => undefined });
  opened.push(sql);
  return sql;
}

const code = async (run: Promise<unknown>): Promise<string | undefined> =>
  run.then(
    () => undefined,
    (error: unknown) => (error as { code?: string }).code,
  );

const insertAudit = (sql: Sql) => sql`
  insert into audit_log (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id, origin, correlation_id)
  values (gen_random_uuid(), 'actor-1', 'user', 'tester', 'test.action', 'thing', 'thing-1', 'ui', 'corr-1')`;

describe("db:create-app-login", () => {
  it("creates a login that can append and read the audit log but not change or remove it", async () => {
    expect(await createAppLogin(owner, { user: USER, password: FIRST })).toBe("created");
    const app = connectAs(USER, FIRST);
    await insertAudit(app);
    const rows = await app<{ n: number }[]>`select count(*)::int as n from audit_log`;
    expect(rows[0]?.n).toBeGreaterThan(0);
    expect(await code(app`update audit_log set reason = 'x'`)).toBe("42501");
    expect(await code(app`delete from audit_log`)).toBe("42501");
    expect(await code(app`truncate audit_log`)).toBe("42501");
    expect(await code(app`create table app_made (id int)`)).toBe("42501");
  });

  it("is idempotent: a second run updates the password and keeps the membership", async () => {
    expect(await createAppLogin(owner, { user: USER, password: SECOND })).toBe("updated");
    await insertAudit(connectAs(USER, SECOND));
    const stale = connectAs(USER, FIRST);
    expect(await code(insertAudit(stale))).toBe("28P01");
    const [member] = await owner<{ yes: boolean }[]>`select pg_has_role(${USER}::text, 'parkline_app', 'member') as yes`;
    expect(member?.yes).toBe(true);
  });

  it("refuses to change a superuser", async () => {
    const [row] = await owner<{ name: string }[]>`select current_user as name`;
    await expect(createAppLogin(owner, { user: row?.name ?? "",  password: FIRST })).rejects.toThrow(/superuser/);
  });
});
