import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { ok, type Result } from "../../src/shared/domain/result";
import { PostgresAuditLog } from "../../src/shared/infrastructure/postgres-audit-log";
import { PostgresUnitOfWork } from "../../src/shared/infrastructure/postgres-unit-of-work";
import { createContainer } from "../../src/shared/infrastructure/container";
import type { IdentityTx } from "../../src/identity/application/ports/identity-tx";
import type { ThrottleSubject } from "../../src/identity/application/ports/sign-in-throttle";
import { createPostgresIdentityTx } from "../../src/identity/infrastructure/postgres-identity-tx";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });
const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const T0 = new Date("2026-01-01T10:00:00.000Z");
const at = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

let admin: Sql;
const created: string[] = [];

beforeAll(() => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  for (const name of created) await admin.unsafe(`drop database if exists ${name}`);
  await admin.end();
});

/** Runs `fn` against a brand new ephemeral database; the development database is never touched. */
async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const name = `parkline_test_${randomBytes(6).toString("hex")}`;
  created.push(name);
  await admin.unsafe(`create database ${name}`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 5, onnotice: () => undefined });
  try {
    await migrate(sql, MIGRATIONS_DIR);
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

function must<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unexpected error result: ${JSON.stringify(result.error)}`);
  return result.value;
}

const uow = (sql: Sql) =>
  new PostgresUnitOfWork<IdentityTx>(sql, (handle) =>
    createPostgresIdentityTx(handle, new PostgresAuditLog(handle)),
  );

/** Creates two tenants and runs `fn` inside one unit of work. */
async function inTx<T>(sql: Sql, fn: (tx: IdentityTx, a: string, b: string) => Promise<T>): Promise<T> {
  const a = randomUUID();
  const b = randomUUID();
  const result = await uow(sql).run(async (tx) => {
    await tx.tenants.add({ id: a, name: "Tenant A" });
    await tx.tenants.add({ id: b, name: "Tenant B" });
    return ok(await fn(tx, a, b));
  });
  return must(result);
}

const email = (hash: string): ThrottleSubject => ({ kind: "email", hash });
const address = (hash: string): ThrottleSubject => ({ kind: "address", hash });

describe("sign_in_attempts schema", () => {
  it("applies 0003 and holds only hashes, no clear-text columns, with restrictive foreign keys", async () => {
    await withDb(async (sql) => {
      const cols = await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns
        where table_name = 'sign_in_attempts' order by column_name`;
      expect(cols.map((c) => c.column_name)).toEqual([
        "attempted_at",
        "id",
        "subject_hash",
        "subject_kind",
        "tenant_id",
      ]);
      const fks = await sql<{ confdeltype: string }[]>`
        select confdeltype from pg_constraint
        where contype = 'f' and conrelid = 'sign_in_attempts'::regclass`;
      expect(fks.map((f) => f.confdeltype)).toEqual(["a"]);
      const count = await sql`select count(*)::int as n from sign_in_attempts`;
      expect(count[0]?.n).toBe(0);
    });
  });

  it("rejects a non-hex, clear-text or wrong-length subject hash and an unknown kind", async () => {
    await withDb(async (sql) => {
      const tenantId = await inTx(sql, (_tx, a) => Promise.resolve(a));
      const insert = (kind: string, hash: string) => sql`
        insert into sign_in_attempts (tenant_id, subject_kind, subject_hash, attempted_at)
        values (${tenantId}, ${kind}, ${hash}, now())`;
      await expect(insert("email", "ana@example.test")).rejects.toThrow();
      await expect(insert("email", "Z".repeat(64))).rejects.toThrow();
      await expect(insert("email", "A".repeat(64))).rejects.toThrow();
      await expect(insert("email", "a".repeat(63))).rejects.toThrow();
      await expect(insert("ip", HEX_A)).rejects.toThrow();
      await insert("email", HEX_A);
    });
  });
});

describe("PostgresSignInThrottle", () => {
  it("failuresSince is strictly after the cutoff", async () => {
    await withDb(async (sql) => {
      const found = await inTx(sql, async (tx, a) => {
        await tx.throttle.recordFailure(a, [email(HEX_A)], at(0));
        await tx.throttle.recordFailure(a, [email(HEX_A)], at(10));
        return tx.throttle.failuresSince(a, [email(HEX_A)], at(0));
      });
      expect(found.map((f) => f.at.getTime())).toEqual([at(10).getTime()]);
    });
  });

  it("prune deletes at or before the cutoff and keeps later rows", async () => {
    await withDb(async (sql) => {
      const left = await inTx(sql, async (tx, a) => {
        await tx.throttle.recordFailure(a, [email(HEX_A)], at(0));
        await tx.throttle.recordFailure(a, [email(HEX_A)], at(10));
        await tx.throttle.prune(a, at(0));
        return tx.throttle.failuresSince(a, [email(HEX_A)], at(-1));
      });
      expect(left.map((f) => f.at.getTime())).toEqual([at(10).getTime()]);
    });
  });

  it("records one row per subject and separates the email and address kinds", async () => {
    await withDb(async (sql) => {
      const found = await inTx(sql, async (tx, a) => {
        await tx.throttle.recordFailure(a, [email(HEX_A), address(HEX_A)], at(5));
        return {
          emailOnly: await tx.throttle.failuresSince(a, [email(HEX_A)], at(0)),
          addressOnly: await tx.throttle.failuresSince(a, [address(HEX_A)], at(0)),
          none: await tx.throttle.failuresSince(a, [email(HEX_B)], at(0)),
        };
      });
      expect(found.emailOnly.map((f) => f.kind)).toEqual(["email"]);
      expect(found.addressOnly.map((f) => f.kind)).toEqual(["address"]);
      expect(found.none).toEqual([]);
    });
  });

  it("is tenant scoped for reads, clear and prune", async () => {
    await withDb(async (sql) => {
      const state = await inTx(sql, async (tx, a, b) => {
        await tx.throttle.recordFailure(a, [email(HEX_A)], at(5));
        await tx.throttle.recordFailure(b, [email(HEX_A)], at(5));
        const seenByB = await tx.throttle.failuresSince(b, [email(HEX_A)], at(0));
        await tx.throttle.clear(a, email(HEX_A));
        await tx.throttle.prune(a, at(100));
        return { seenByB, afterA: await tx.throttle.failuresSince(a, [email(HEX_A)], at(0)), afterB: await tx.throttle.failuresSince(b, [email(HEX_A)], at(0)) };
      });
      expect(state.seenByB).toHaveLength(1);
      expect(state.afterA).toEqual([]);
      expect(state.afterB).toHaveLength(1);
    });
  });

  it("clear forgets only its own subject", async () => {
    await withDb(async (sql) => {
      const left = await inTx(sql, async (tx, a) => {
        await tx.throttle.recordFailure(a, [email(HEX_A), address(HEX_A), email(HEX_B)], at(5));
        await tx.throttle.clear(a, email(HEX_A));
        return tx.throttle.failuresSince(a, [email(HEX_A), address(HEX_A), email(HEX_B)], at(0));
      });
      expect(left.map((f) => `${f.kind}:${f.hash.slice(0, 1)}`).sort()).toEqual(["address:a", "email:b"]);
    });
  });

  it("returns empty and writes nothing for a malformed tenant id or an empty subject list", async () => {
    await withDb(async (sql) => {
      const found = await inTx(sql, async (tx, a) => {
        await tx.throttle.recordFailure("not-a-uuid", [email(HEX_A)], at(5));
        await tx.throttle.recordFailure(a, [], at(5));
        await tx.throttle.clear("not-a-uuid", email(HEX_A));
        await tx.throttle.prune("not-a-uuid", at(5));
        return [
          ...(await tx.throttle.failuresSince("not-a-uuid", [email(HEX_A)], at(0))),
          ...(await tx.throttle.failuresSince(a, [], at(0))),
        ];
      });
      expect(found).toEqual([]);
      expect((await sql`select count(*)::int as n from sign_in_attempts`)[0]?.n).toBe(0);
    });
  });
});

describe("SignIn throttling end to end", () => {
  const install = { tenantName: "Synthetic Tenant", email: "admin@example.test", displayName: "Admin", password: PASSWORD };
  const attempt = (c: ReturnType<typeof createContainer>, who: string, password: string) =>
    c.identity.signIn.execute({ email: who, password });
  const code = (r: Awaited<ReturnType<typeof attempt>>): string | null => (r.ok ? null : r.error.code);

  it("locks after 5 wrong passwords, stores only hashes and audits one lock", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(await c.identity.install.execute(install));
      for (let i = 0; i < 5; i += 1) expect(code(await attempt(c, install.email, "wrong-password-1"))).toBe("invalid_credentials");
      expect(code(await attempt(c, install.email, PASSWORD))).toBe("too_many_attempts");
      const rows = await sql<{ subject_kind: string; subject_hash: string }[]>`
        select subject_kind, subject_hash from sign_in_attempts`;
      expect(rows).toHaveLength(5);
      for (const row of rows) {
        expect(row.subject_kind).toBe("email");
        expect(row.subject_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.subject_hash).not.toContain("admin");
      }
      const locked = await sql`select 1 from audit_log where action = 'auth.sign_in_locked'`;
      expect(locked).toHaveLength(1);
      const failed = await sql`select 1 from audit_log where action = 'auth.sign_in_failed'`;
      expect(failed).toHaveLength(5);
    });
  });

  it("a success before the limit clears the email counter", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(await c.identity.install.execute(install));
      for (let i = 0; i < 4; i += 1) await attempt(c, install.email, "wrong-password-1");
      must(await attempt(c, install.email, PASSWORD));
      expect((await sql`select count(*)::int as n from sign_in_attempts`)[0]?.n).toBe(0);
      for (let i = 0; i < 4; i += 1) expect(code(await attempt(c, install.email, "wrong-password-1"))).toBe("invalid_credentials");
      must(await attempt(c, install.email, PASSWORD));
    });
  });

  it("an unknown email is throttled with the same outcome and rows", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(await c.identity.install.execute(install));
      const ghost = "ghost@example.test";
      for (let i = 0; i < 5; i += 1) expect(code(await attempt(c, ghost, PASSWORD))).toBe("invalid_credentials");
      const sixth = await attempt(c, ghost, PASSWORD);
      expect(code(sixth)).toBe("too_many_attempts");
      expect((await sql`select count(*)::int as n from sign_in_attempts`)[0]?.n).toBe(5);
      expect(await sql`select 1 from audit_log where action = 'auth.sign_in_locked'`).toHaveLength(1);
    });
  });
});
