import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import type { AuditEntry } from "../../src/shared/domain/ports/audit-log";
import { ok, type Result } from "../../src/shared/domain/result";
import { hasReason, SENSITIVE_AUDIT_ACTIONS } from "../../src/shared/domain/sensitive-actions";
import { createContainer } from "../../src/shared/infrastructure/container";
import { PostgresAuditLog } from "../../src/shared/infrastructure/postgres-audit-log";
import { PostgresUnitOfWork } from "../../src/shared/infrastructure/postgres-unit-of-work";
import type { IdentityTx } from "../../src/identity/application/ports/identity-tx";
import { createPostgresIdentityTx } from "../../src/identity/infrastructure/postgres-identity-tx";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });
const APP_ROLE = "parkline_app";

let admin: Sql;
const created: string[] = [];

beforeAll(() => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  for (const name of created) await admin.unsafe(`drop database if exists ${name}`);
  await admin.end();
});

/**
 * Runs `fn` against a brand new migrated database, with the owner connection. The group role
 * `parkline_app` is cluster-wide and shared (migration 0004 creates it only if missing); it is
 * deliberately not dropped here because parallel test files use it at the same time.
 */
async function withDb<T>(fn: (owner: Sql, url: string) => Promise<T>): Promise<T> {
  const name = `parkline_test_${randomBytes(6).toString("hex")}`;
  created.push(name);
  await admin.unsafe(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const owner = postgres(url.toString(), { max: 5, onnotice: () => undefined });
  try {
    await migrate(owner, MIGRATIONS_DIR);
    return await fn(owner, url.toString());
  } finally {
    await owner.end();
  }
}

function must<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected error result: ${JSON.stringify(result.error)}`);
  return result.value;
}

type AuditValues = { action: string; reason?: string | null };

const insertAudit = (sql: Sql | TransactionSql, { action, reason = null }: AuditValues) => sql`
  insert into audit_log
    (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id, origin, correlation_id, reason)
  values
    (gen_random_uuid(), 'actor-1', 'user', 'tester', ${action}, 'thing', 'thing-1', 'ui', 'corr-1', ${reason})`;

type PgError = { code?: string; message: string };
const asPgError = (e: unknown): PgError => e as PgError;

/**
 * Runs `statement` as `parkline_app` inside a transaction that is always rolled back, and returns
 * the error it raised (or null). With `triggersOff` the owner first disables every user trigger on
 * audit_log, so a failure can only come from the privilege layer.
 */
async function failureAsApp(
  owner: Sql,
  statement: string,
  options: { triggersOff?: boolean } = {},
): Promise<PgError | null> {
  const rollback = new Error("rollback");
  let raised: PgError | null = null;
  try {
    await owner.begin(async (tx) => {
      await insertAudit(tx, { action: "test.action" });
      if (options.triggersOff) await tx.unsafe("alter table audit_log disable trigger user");
      await tx.unsafe(`set local role ${APP_ROLE}`);
      try {
        await tx.savepoint((sp) => sp.unsafe(statement));
      } catch (error) {
        raised = error as PgError;
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  return raised;
}

describe("sensitive-action reason trigger (owner connection)", () => {
  const blanks: readonly (string | null)[] = [
    null,
    "",
    "   ",
    "\t\n ",
    "\u00A0",
    "\u200B",
    "\u3000",
    "\uFEFF",
    "\u2060",
    "\u0085",
    " \t\u00A0\u200B\n\u3000\uFEFF\r",
  ];

  it("rejects every sensitive action with a null, empty or blank reason", async () => {
    await withDb(async (owner) => {
      for (const action of SENSITIVE_AUDIT_ACTIONS) {
        for (const reason of blanks) {
          const error = await insertAudit(owner, { action, reason }).then(
            () => null,
            asPgError,
          );
          expect(error?.code, `${action} / ${JSON.stringify(reason)}`).toBe("23514");
          expect(error?.message).toContain(action);
        }
      }
      const rows = await owner`select count(*)::int as n from audit_log`;
      expect(rows[0]?.n).toBe(0);
    });
  });

  it("does not echo the reason or any other value in the error message", async () => {
    await withDb(async (owner) => {
      const error = await insertAudit(owner, { action: "role.change", reason: "  " }).catch(asPgError);
      expect((error as PgError).message).toBe('audit action "role.change" requires a non-blank reason');
    });
  });

  it("accepts every sensitive action with a reason", async () => {
    await withDb(async (owner) => {
      for (const action of SENSITIVE_AUDIT_ACTIONS) {
        await insertAudit(owner, { action, reason: "documented reason" });
      }
      const rows = await owner`select count(*)::int as n from audit_log`;
      expect(rows[0]?.n).toBe(SENSITIVE_AUDIT_ACTIONS.length);
    });
  });

  it("lists exactly SENSITIVE_AUDIT_ACTIONS in the trigger function (no drift in either direction)", async () => {
    await withDb(async (owner) => {
      const rows = await owner<{ src: string }[]>`select prosrc as src from pg_proc where proname = 'audit_log_require_reason'`;
      expect(rows).toHaveLength(1);
      const list = /new\.action in \(([^)]*)\)/.exec(rows[0]?.src ?? "")?.[1] ?? "";
      const inSql = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
      expect(inSql).toEqual([...SENSITIVE_AUDIT_ACTIONS]);
    });
  });

  it.each(["organization.operation.update", "organization.archive", "organization.restore"])(
    "%s needs a visible reason: null, empty, blank and invisible-only are refused",
    async (action) => {
      await withDb(async (owner) => {
        for (const reason of [null, "", "  ", String.fromCharCode(0x200b, 0xa0, 0xfeff), String.fromCharCode(0x3000, 0x2060)]) {
          const error = await insertAudit(owner, { action, reason }).then(() => null, asPgError);
          expect(error?.code, JSON.stringify(reason)).toBe("23514");
          expect(error?.message).toBe(`audit action "${action}" requires a non-blank reason`);
        }
        await insertAudit(owner, { action, reason: "Motivo documentado" });
        const rows = await owner`select count(*)::int as n from audit_log`;
        expect(rows[0]?.n).toBe(1);
      });
    },
  );

  it("accepts a reason with a visible character among invisible ones", async () => {
    await withDb(async (owner) => {
      const reasons = ["\u200B\u00A0x\uFEFF", "\u200E", " ok "];
      for (const reason of reasons) await insertAudit(owner, { action: "role.assign", reason });
      const rows = await owner`select count(*)::int as n from audit_log`;
      expect(rows[0]?.n).toBe(reasons.length);
    });
  });

  it("agrees with hasReason on every boundary character of the blank set (no drift)", async () => {
    const edges = [0x09, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x200d, 0x2028, 0x2029, 0x202f, 0x205f, 0x2060, 0x3000, 0xfeff];
    const codes = new Set<number>();
    for (let c = 0x09; c <= 0x0d; c++) codes.add(c);
    for (const edge of edges) for (const delta of [-1, 0, 1]) codes.add(edge + delta);
    for (let c = 0x2000; c <= 0x200d; c++) codes.add(c);
    await withDb(async (owner) => {
      for (const code of codes) {
        const reason = String.fromCharCode(code);
        const error = await insertAudit(owner, { action: "role.assign", reason }).then(() => null, asPgError);
        const label = `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
        expect(error === null, `${label}: database accepts`).toBe(hasReason(reason));
      }
    });
  });

  it("accepts a non-sensitive action without a reason", async () => {
    await withDb(async (owner) => {
      await insertAudit(owner, { action: "user.create", reason: null });
      await insertAudit(owner, { action: "user.create", reason: "" });
      const rows = await owner`select count(*)::int as n from audit_log`;
      expect(rows[0]?.n).toBe(2);
    });
  });
});

describe("restricted application role", () => {
  it("is a NOLOGIN role without a password, superuser or create rights", async () => {
    await withDb(async (owner) => {
      const rows = await owner<Record<string, unknown>[]>`
        select r.rolcanlogin, r.rolsuper, r.rolcreatedb, r.rolcreaterole, a.rolpassword is not null as has_pw
        from pg_roles r join pg_authid a on a.oid = r.oid where r.rolname = ${APP_ROLE}`;
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        rolcanlogin: false,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        has_pw: false,
      });
    });
  });

  it("can SELECT and INSERT on audit_log", async () => {
    await withDb(async (owner) => {
      const app = await owner.begin(async (tx) => {
        await tx.unsafe(`set local role ${APP_ROLE}`);
        await insertAudit(tx, { action: "role.assign", reason: "granted by test" });
        return tx`select action, current_user as who from audit_log`;
      });
      expect(app).toHaveLength(1);
      expect(app[0]).toMatchObject({ action: "role.assign", who: APP_ROLE });
    });
  });

  for (const statement of [
    "update audit_log set reason = 'tampered'",
    "delete from audit_log",
    "truncate table audit_log",
  ]) {
    it(`privilege layer: "${statement}" fails with 42501 even with the triggers disabled`, async () => {
      await withDb(async (owner) => {
        const error = await failureAsApp(owner, statement, { triggersOff: true });
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(/permission denied for table audit_log/);
        expect(error?.message).not.toMatch(/append-only/);
      });
    });

    it(`"${statement}" fails with 42501 with the triggers enabled, stopped by privileges first`, async () => {
      await withDb(async (owner) => {
        const error = await failureAsApp(owner, statement);
        expect(error?.code).toBe("42501");
        expect(error?.message).toMatch(/permission denied for table audit_log/);
      });
    });
  }

  it("trigger layer: the owner is still stopped by the append-only trigger", async () => {
    await withDb(async (owner) => {
      await insertAudit(owner, { action: "test.action" });
      const error = await owner`update audit_log set reason = 'x'`.catch(asPgError);
      expect((error as PgError).code).toBe("42501");
      expect((error as PgError).message).toMatch(/append-only/);
    });
  });

  it("cannot reference, trigger or alter audit_log, nor create objects", async () => {
    await withDb(async (owner) => {
      const fn = await owner`select 1 as ok from pg_proc where proname = 'audit_log_require_reason'`;
      expect(fn).toHaveLength(1);
      const statements = [
        "create table intruder (id int)",
        "alter table audit_log add column extra text",
        "alter table audit_log disable trigger user",
        "drop table audit_log",
        "create trigger t before insert on audit_log for each row execute function audit_log_require_reason()",
        "create schema intruder",
        "create function intruder() returns int language sql as 'select 1'",
      ];
      for (const statement of statements) {
        const error = await failureAsApp(owner, statement);
        expect(error?.code, statement).toBe("42501");
      }
    });
  });

  it("holds exactly SELECT and INSERT on audit_log, and no TRUNCATE anywhere", async () => {
    await withDb(async (owner) => {
      const privilegesOn = async (table: string) => {
        const rows = await owner<{ p: string }[]>`
          select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
          where has_table_privilege(${APP_ROLE}, ${table}, p) order by p`;
        return rows.map((r) => r.p);
      };
      expect(await privilegesOn("audit_log")).toEqual(["INSERT", "SELECT"]);
      const tables = await owner<{ table_name: string }[]>`
        select table_name from information_schema.tables where table_schema = 'public'`;
      for (const { table_name } of tables) {
        const held = await privilegesOn(table_name);
        expect(held, table_name).not.toContain("TRUNCATE");
        expect(held, table_name).not.toContain("REFERENCES");
        expect(held, table_name).not.toContain("TRIGGER");
      }
    });
  });

  it("gives tables created by later migrations the default grants but never TRUNCATE", async () => {
    await withDb(async (owner) => {
      await owner.unsafe("create table later_table (id int generated always as identity primary key)");
      const held = await owner<{ p: string }[]>`
        select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p
        where has_table_privilege(${APP_ROLE}, 'later_table', p) order by p`;
      expect(held.map((r) => r.p)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
      const seq = await owner`select has_sequence_privilege(${APP_ROLE}, 'later_table_id_seq', 'USAGE') as ok`;
      expect(seq[0]?.ok).toBe(true);
    });
  });

  it("migration is idempotent for the cluster-level role: a second database reuses it", async () => {
    await withDb(() => Promise.resolve());
    await withDb(async (owner) => {
      const rows = await owner`select count(*)::int as n from pg_roles where rolname = ${APP_ROLE}`;
      expect(rows[0]?.n).toBe(1);
    });
  });
});

describe("rollback of business writes when the reason rule fails (real unit of work)", () => {
  type Scope = { readonly tx: IdentityTx; readonly handle: TransactionSql };
  const unitOfWork = (sql: Sql) =>
    new PostgresUnitOfWork<Scope>(sql, (handle) => ({
      tx: createPostgresIdentityTx(handle, new PostgresAuditLog(handle)),
      handle,
    }));
  const entry = (tenantId: string): AuditEntry => ({
    occurredAt: new Date("2026-01-01T00:00:00Z"),
    actorId: "actor-1",
    actorKind: "user",
    actorRole: "tester",
    action: "role.change",
    entityType: "user",
    entityId: "user-1",
    tenantId,
    correlationId: "corr-1",
    origin: "ui",
    reason: "\u200B \uFEFF",
  });
  const persisted = async (owner: Sql, tenantId: string) => {
    const tenants = await owner<{ n: number }[]>`select count(*)::int as n from tenants where id = ${tenantId}`;
    const audits = await owner<{ n: number }[]>`select count(*)::int as n from audit_log`;
    return { tenants: tenants[0]?.n, audits: audits[0]?.n };
  };

  it("adapter guard: a blank reason rejects the unit of work and the tenant row is not persisted", async () => {
    await withDb(async (owner) => {
      const tenantId = randomUUID();
      await expect(
        unitOfWork(owner).run(async ({ tx }) => {
          await tx.tenants.add({ id: tenantId, name: "Synthetic Rollback Tenant" });
          await tx.audit.record(entry(tenantId));
          return ok(undefined);
        }),
      ).rejects.toThrow(/role\.change.*reason/);
      expect(await persisted(owner, tenantId)).toEqual({ tenants: 0, audits: 0 });
    });
  });

  it("database trigger: bypassing the adapter still rolls the business write back", async () => {
    await withDb(async (owner) => {
      const tenantId = randomUUID();
      const error = await unitOfWork(owner)
        .run(async ({ tx, handle }) => {
          await tx.tenants.add({ id: tenantId, name: "Synthetic Rollback Tenant" });
          await insertAudit(handle, { action: "role.change", reason: "\u200B" });
          return ok(undefined);
        })
        .catch(asPgError);
      expect((error as PgError).code).toBe("23514");
      expect(await persisted(owner, tenantId)).toEqual({ tenants: 0, audits: 0 });
    });
  });

  it("control: with a visible reason the same unit of work commits both rows", async () => {
    await withDb(async (owner) => {
      const tenantId = randomUUID();
      const result = await unitOfWork(owner).run(async ({ tx }) => {
        await tx.tenants.add({ id: tenantId, name: "Synthetic Committed Tenant" });
        await tx.audit.record({ ...entry(tenantId), reason: "documented" });
        return ok(undefined);
      });
      expect(result.ok).toBe(true);
      expect(await persisted(owner, tenantId)).toEqual({ tenants: 1, audits: 1 });
    });
  });
});

describe("identity flow with every connection running as parkline_app", () => {
  it("installs, signs in, creates a user, changes role, deactivates and throttles", async () => {
    await withDb(async (owner, url) => {
      const app = postgres(url, {
        max: 5,
        onnotice: () => undefined,
        connection: { role: APP_ROLE },
      });
      try {
        const who = await app`select current_user as who`;
        expect(who[0]?.who).toBe(APP_ROLE);

        const c = createContainer(app, { hasher });
        const admin = { email: "admin@example.test", password: PASSWORD };
        must(await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...admin }));
        const signed = must(await c.identity.signIn.execute(admin));
        const actor = must(await c.identity.authenticate.execute({ token: signed.token }));
        const ana = must(
          await c.identity.createUser.execute({
            actor,
            email: "ana@example.test",
            displayName: "Ana",
            password: PASSWORD,
            role: "viewer",
          }),
        );
        must(
          await c.identity.changeUserRole.execute({
            actor,
            userId: ana.id,
            newRole: "manager",
            reason: "promoted to manager",
          }),
        );
        must(await c.identity.deactivateUser.execute({ actor, userId: ana.id, reason: "left the company" }));
        must(await c.identity.signOut.execute({ token: signed.token }));

        let blocked: string | null = null;
        for (let i = 0; i < 10 && blocked === null; i++) {
          const attempt = await c.identity.signIn.execute({ email: admin.email, password: "wrong-password-value" });
          if (!attempt.ok && attempt.error.code === "too_many_attempts") blocked = attempt.error.code;
        }
        expect(blocked).toBe("too_many_attempts");

        const actions = await owner<{ action: string }[]>`select action from audit_log order by id`;
        const seen = actions.map((a) => a.action);
        expect(seen).toEqual(expect.arrayContaining(["role.change", "user.deactivate"]));
      } finally {
        await app.end();
      }
    });
  });
});
