import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAppLogin } from "../../scripts/app-login";
import { migrate } from "../../scripts/migrate";
import { RestrictedLoginError, assertOwnerConnection, describeFailure, isRestrictedLogin } from "../../scripts/privilege-hint";

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
  for (const user of extraUsers) await admin.unsafe(`drop role if exists ${user}`);
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

const extraUsers: string[] = [];

/** Throwaway password with the characters that break naive SQL building (generated at runtime). */
function awkwardPassword(): string {
  return `${randomBytes(6).toString("hex")}'"\\;$% ${randomBytes(3).toString("hex")}`;
}

/** Connects with explicit options so the password never goes through URL encoding. */
function connectAsOptions(user: string, password: string): Sql {
  const sql = postgres({
    host: adminUrl.hostname,
    port: Number(adminUrl.port || 5432),
    database: DB,
    username: user,
    password,
    max: 1,
    onnotice: () => undefined,
  });
  opened.push(sql);
  return sql;
}

async function expectPlainAppLogin(user: string): Promise<void> {
  const [role] = await owner<{ rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolcanlogin: boolean }[]>`
    select rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin from pg_roles where rolname = ${user}::text`;
  expect(role).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolcanlogin: true });
  const groups = await owner<{ name: string }[]>`
    select g.rolname as name from pg_auth_members m
    join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
    where u.rolname = ${user}::text`;
  expect(groups.map((group) => group.name)).toEqual(["parkline_app"]);
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

  it("keeps awkward passwords intact on create and on update, and alters no other statement", async () => {
    const user = `parkline_test_awk_${suffix}`;
    extraUsers.push(user);
    const first = awkwardPassword();
    expect(await createAppLogin(owner, { user, password: first })).toBe("created");
    await insertAudit(connectAsOptions(user, first));
    await expectPlainAppLogin(user);
    const second = awkwardPassword();
    expect(await createAppLogin(owner, { user, password: second })).toBe("updated");
    await insertAudit(connectAsOptions(user, second));
    expect(await code(insertAudit(connectAsOptions(user, first)))).toBe("28P01");
    await expectPlainAppLogin(user);
  });

  it.each([1, 2, 3, 4, 5, 6])("serializes two concurrent runs (round %i): both succeed, one valid login results", async (round) => {
    const user = `parkline_test_race${String(round)}_${suffix}`;
    extraUsers.push(user);
    const passwords = [`race-a-${randomBytes(9).toString("hex")}`, `race-b-${randomBytes(9).toString("hex")}`];
    const outcomes = await Promise.all(passwords.map((password) => createAppLogin(owner, { user, password })));
    expect([...outcomes].sort()).toEqual(["created", "updated"]);
    const [count] = await owner<{ n: number }[]>`select count(*)::int as n from pg_roles where rolname = ${user}::text`;
    expect(count?.n).toBe(1);
    await expectPlainAppLogin(user);
    const results = await Promise.all(passwords.map((password) => code(insertAudit(connectAs(user, password)))));
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
  });

  it("refuses to change a superuser", async () => {
    const [row] = await owner<{ name: string }[]>`select current_user as name`;
    await expect(createAppLogin(owner, { user: row?.name ?? "",  password: FIRST })).rejects.toThrow(/superuser/);
  });
});

describe("running owner-only commands with the restricted login", () => {
  const user = `parkline_test_hint_${suffix}`;
  const password = `hint-${randomBytes(9).toString("hex")}`;

  it("tells the owner connection from the application login", async () => {
    extraUsers.push(user);
    await createAppLogin(owner, { user, password });
    expect(await isRestrictedLogin(owner)).toBe(false);
    expect(await isRestrictedLogin(connectAs(user, password))).toBe(true);
  });

  it("answers false, without failing, while the group role does not exist yet", async () => {
    expect(await isRestrictedLogin(owner, `parkline_missing_${suffix}`)).toBe(false);
    expect(await isRestrictedLogin(connectAs(user, password), `parkline_missing_${suffix}`)).toBe(false);
  });

  it("does not mistake an owner that only administers the group role for the application login", async () => {
    const admin2 = `parkline_test_adm_${suffix}`;
    const pw = `adm-${randomBytes(9).toString("hex")}`;
    extraUsers.push(admin2);
    await owner.unsafe(`create role ${admin2} login nosuperuser createrole password '${pw}'`);
    await owner.unsafe(`grant parkline_app to ${admin2} with admin option, inherit false, set false`);
    expect(await isRestrictedLogin(connectAs(admin2, pw))).toBe(false);
  });

  it("refuses to start as the application login and explains how to fix it", async () => {
    const app = connectAs(user, password);
    const failure = await assertOwnerConnection(app).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RestrictedLoginError);
    expect(describeFailure(failure, {})).toContain("MIGRATE_DATABASE_URL");
  });

  it("explains the raw permission error Postgres gives when the check is skipped", async () => {
    const app = connectAs(user, password);
    const failure = await app`create table hint_made (id int)`.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect((failure as { code?: string }).code).toBe("42501");
    expect(describeFailure(failure, {})).toContain("MIGRATE_DATABASE_URL");
  });
});
