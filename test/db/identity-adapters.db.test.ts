import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import type { AuditEntry, AuditLog } from "../../src/shared/domain/ports/audit-log";
import { err, ok, type Result } from "../../src/shared/domain/result";
import { PostgresAuditLog } from "../../src/shared/infrastructure/postgres-audit-log";
import { PostgresUnitOfWork } from "../../src/shared/infrastructure/postgres-unit-of-work";
import { createContainer } from "../../src/shared/infrastructure/container";
import type { IdentityTx } from "../../src/identity/application/ports/identity-tx";
import type { TenantRepository } from "../../src/identity/application/ports/tenant-repository";
import type { IdentityDeps } from "../../src/identity/application/deps";
import type { UserRepository } from "../../src/identity/application/ports/user-repository";
import { CreateUser } from "../../src/identity/application/use-cases/create-user";
import { InstallTenantAdmin } from "../../src/identity/application/use-cases/install-tenant-admin";
import { DEFAULT_SESSION_POLICY } from "../../src/identity/domain/session";
import { CryptoSessionTokenService } from "../../src/identity/infrastructure/crypto-session-token-service";
import { SystemClock } from "../../src/shared/infrastructure/system-clock";
import { UuidIdGenerator } from "../../src/shared/infrastructure/uuid-id-generator";
import { createRoleAssignment }from "../../src/identity/domain/role-assignment";
import type { Session } from "../../src/identity/domain/session";
import type { User } from "../../src/identity/domain/user";
import { createPostgresIdentityTx } from "../../src/identity/infrastructure/postgres-identity-tx";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });

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
  const sql = postgres(url.toString(), { max: 10, onnotice: () => undefined });
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

const uow = (sql: Sql, audit?: (inner: AuditLog) => AuditLog) =>
  new PostgresUnitOfWork<IdentityTx>(sql, (handle) =>
    createPostgresIdentityTx(handle, audit?.(new PostgresAuditLog(handle))),
  );

const newUser = (tenantId: string, email: string): User => ({
  id: randomUUID(),
  tenantId,
  email,
  displayName: "Synthetic User",
  active: true,
});

const newSession = (user: User, tokenHash: string): Session => ({
  id: randomUUID(),
  tenantId: user.tenantId,
  userId: user.id,
  tokenHash,
  createdAt: new Date("2026-01-01T09:00:00Z"),
  lastSeenAt: new Date("2026-01-01T09:00:00Z"),
  expiresAt: new Date("2026-01-08T09:00:00Z"),
  revokedAt: null,
});

/** Holds callers until `parties` arrived or `timeoutMs` passed, to force overlapping transactions. */
const makeGate = (parties: number, timeoutMs: number): (() => Promise<void>) => {
  let arrived = 0;
  let open!: () => void;
  const opened = new Promise<void>((resolveGate) => {
    open = resolveGate;
  });
  setTimeout(open, timeoutMs);
  return async () => {
    arrived += 1;
    if (arrived >= parties) open();
    await opened;
  };
};

const gatedTenants = (inner: TenantRepository, gate: () => Promise<void>): TenantRepository => ({
  lockForInstall: () => inner.lockForInstall(),
  add: (tenant) => inner.add(tenant),
  findSingle: async () => {
    const found = await inner.findSingle();
    await gate();
    return found;
  },
});

const gatedUsers = (inner: UserRepository, gate: () => Promise<void>): UserRepository => ({
  findById: (tenantId, id) => inner.findById(tenantId, id),
  add: (user, passwordHash) => inner.add(user, passwordHash),
  setActive: (tenantId, id, active) => inner.setActive(tenantId, id, active),
  listByTenant: (tenantId) => inner.listByTenant(tenantId),
  findByEmail: async (tenantId, email) => {
    const found = await inner.findByEmail(tenantId, email);
    await gate();
    return found;
  },
});

const installInput = {
  tenantName: "Synthetic Tenant",
  email: "Admin@Example.test",
  displayName: "Synthetic Admin",
  password: PASSWORD,
};

describe("postgres identity repositories", () => {
  it("round-trips tenant, user, assignment and session", async () => {
    await withDb(async (sql) => {
      const tenant = { id: randomUUID(), name: "Tenant A" };
      const user = newUser(tenant.id, "ana@example.test");
      const session = newSession(user, "a".repeat(64));
      const assignment = must(
        createRoleAssignment({ userId: user.id, role: "manager", scope: { type: "tenant", id: tenant.id } }),
      );
      await uow(sql).run(async (tx) => {
        await tx.tenants.add(tenant);
        await tx.users.add(user, "scrypt$stored");
        await tx.assignments.add(tenant.id, assignment);
        await tx.sessions.add(session);
        return ok(undefined);
      });
      const read = await uow(sql).run(async (tx) =>
        ok({
          single: await tx.tenants.findSingle(),
          byId: await tx.users.findById(tenant.id, user.id),
          byEmail: await tx.users.findByEmail(tenant.id, user.email),
          roles: await tx.assignments.listActiveByUser(tenant.id, user.id),
          admins: await tx.assignments.countActiveAdminUsers(tenant.id),
          session: await tx.sessions.findByTokenHash(session.tokenHash),
        }),
      );
      const state = must(read);
      expect(state.single).toEqual(tenant);
      expect(state.byId).toEqual(user);
      expect(state.byEmail).toEqual({ user, passwordHash: "scrypt$stored" });
      expect(state.roles).toEqual([assignment]);
      expect(state.admins).toBe(0);
      expect(state.session).toEqual(session);
    });
  });

  it("updates user activity, assignments and sessions", async () => {
    await withDb(async (sql) => {
      const tenant = { id: randomUUID(), name: "Tenant A" };
      const user = newUser(tenant.id, "ana@example.test");
      const session = newSession(user, "b".repeat(64));
      const admin = must(
        createRoleAssignment({ userId: user.id, role: "admin", scope: { type: "tenant", id: tenant.id } }),
      );
      const at = new Date("2026-01-02T00:00:00Z");
      const after = await uow(sql).run(async (tx) => {
        await tx.tenants.add(tenant);
        await tx.users.add(user, "h");
        await tx.assignments.add(tenant.id, admin);
        await tx.sessions.add(session);
        const admins = await tx.assignments.countActiveAdminUsers(tenant.id);
        await tx.sessions.touch(tenant.id, session.id, at);
        await tx.sessions.revokeAllForUser(tenant.id, user.id, at);
        await tx.assignments.deactivate(tenant.id, admin);
        await tx.users.setActive(tenant.id, user.id, false);
        return ok({
          admins,
          session: await tx.sessions.findByTokenHash(session.tokenHash),
          roles: await tx.assignments.listActiveByUser(tenant.id, user.id),
          user: await tx.users.findById(tenant.id, user.id),
        });
      });
      const state = must(after);
      expect(state.admins).toBe(1);
      expect(state.session).toMatchObject({ lastSeenAt: at, revokedAt: at });
      expect(state.roles).toEqual([]);
      expect(state.user?.active).toBe(false);
    });
  });

  it("never reads or writes across tenants", async () => {
    await withDb(async (sql) => {
      const a = { id: randomUUID(), name: "Tenant A" };
      const b = { id: randomUUID(), name: "Tenant B" };
      const ana = newUser(a.id, "ana@example.test");
      const session = newSession(ana, "c".repeat(64));
      const role = must(
        createRoleAssignment({ userId: ana.id, role: "viewer", scope: { type: "tenant", id: a.id } }),
      );
      const result = await uow(sql).run(async (tx) => {
        await tx.tenants.add(a);
        await tx.tenants.add(b);
        await tx.users.add(ana, "h");
        await tx.assignments.add(a.id, role);
        await tx.sessions.add(session);
        await tx.users.setActive(b.id, ana.id, false);
        await tx.assignments.deactivate(b.id, role);
        await tx.sessions.revoke(b.id, session.id, new Date());
        await tx.sessions.revokeAllForUser(b.id, ana.id, new Date());
        return ok({
          byId: await tx.users.findById(b.id, ana.id),
          byEmail: await tx.users.findByEmail(b.id, ana.email),
          roles: await tx.assignments.listActiveByUser(b.id, ana.id),
          admins: await tx.assignments.countActiveAdminUsers(b.id),
          own: await tx.users.findById(a.id, ana.id),
          ownRoles: await tx.assignments.listActiveByUser(a.id, ana.id),
          ownSession: await tx.sessions.findByTokenHash(session.tokenHash),
        });
      });
      const state = must(result);
      expect(state.byId).toBeNull();
      expect(state.byEmail).toBeNull();
      expect(state.roles).toEqual([]);
      expect(state.admins).toBe(0);
      expect(state.own?.active).toBe(true);
      expect(state.ownRoles).toHaveLength(1);
      expect(state.ownSession?.revokedAt).toBeNull();
    });
  });

  it("treats a malformed id as not found instead of failing", async () => {
    await withDb(async (sql) => {
      const found = await uow(sql).run(async (tx) => ok(await tx.users.findById(randomUUID(), "not-a-uuid")));
      expect(must(found)).toBeNull();
    });
  });
});

describe("PostgresUnitOfWork", () => {
  const insertTenant = (tx: IdentityTx) => tx.tenants.add({ id: randomUUID(), name: "Tenant" });
  const count = async (sql: Sql): Promise<number | undefined> => {
    const rows = await sql<{ n: number }[]>`select count(*)::int as n from tenants`;
    return rows[0]?.n;
  };

  it("commits only an ok result", async () => {
    await withDb(async (sql) => {
      await uow(sql).run(async (tx) => {
        await insertTenant(tx);
        return ok(undefined);
      });
      expect(await count(sql)).toBe(1);
    });
  });

  it("rolls back an err result without throwing", async () => {
    await withDb(async (sql) => {
      const result = await uow(sql).run(async (tx) => {
        await insertTenant(tx);
        return err("rejected" as const);
      });
      expect(result).toEqual({ ok: false, error: "rejected" });
      expect(await count(sql)).toBe(0);
    });
  });

  it("rolls back and rethrows when the work throws", async () => {
    await withDb(async (sql) => {
      const attempt = uow(sql).run(async (tx) => {
        await insertTenant(tx);
        throw new Error("boom");
      });
      await expect(attempt).rejects.toThrow("boom");
      expect(await count(sql)).toBe(0);
    });
  });
});

describe("identity use cases on Postgres", () => {
  it("stores only the hash of the session token", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(await c.identity.install.execute(installInput));
      const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
      const rows = await sql<{ doc: string; token_hash: string }[]>`
        select s::text as doc, token_hash from sessions s`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.doc).not.toContain(signed.token);
      expect(rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it("persists one failed sign-in audit row and no session", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(await c.identity.install.execute(installInput));
      const wrong = await c.identity.signIn.execute({ email: "admin@example.test", password: "wrong-password-123" });
      expect(!wrong.ok && wrong.error.code).toBe("invalid_credentials");
      const rows = await sql`select action, role from audit_log where action = 'auth.sign_in_failed'`;
      expect(rows).toHaveLength(1);
      expect((await sql`select count(*)::int as n from sessions`)[0]?.n).toBe(0);
    });
  });

  it("rolls the business change back when the audit insert fails", async () => {
    await withDb(async (sql) => {
      const good = createContainer(sql, { hasher });
      must(await good.identity.install.execute(installInput));
      const failing = createContainer(sql, {
        hasher,
        wrapAudit: (inner): AuditLog => ({
          record: (entry: AuditEntry) =>
            entry.action === "user.create" ? Promise.reject(new Error("audit down")) : inner.record(entry),
        }),
      });
      const signed = must(await good.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
      const actor = must(await good.identity.authenticate.execute({ token: signed.token }));
      const attempt = failing.identity.createUser.execute({
        actor,
        email: "ana@example.test",
        displayName: "Ana",
        password: PASSWORD,
        role: "viewer",
      });
      await expect(attempt).rejects.toThrow("audit down");
      expect((await sql`select count(*)::int as n from users`)[0]?.n).toBe(1);
      expect((await sql`select count(*)::int as n from user_role_assignments`)[0]?.n).toBe(1);
    });
  });

  it("maps a concurrent duplicate email to EmailTakenError with one audit row", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(await c.identity.install.execute(installInput));
      const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
      const actor = must(await c.identity.authenticate.execute({ token: signed.token }));
      // The gate makes both calls pass the email pre-check before either inserts.
      const gate = makeGate(2, 400);
      const deps: IdentityDeps = {
        unitOfWork: new PostgresUnitOfWork(sql, (handle) => {
          const tx = createPostgresIdentityTx(handle);
          return { ...tx, users: gatedUsers(tx.users, gate) };
        }),
        clock: new SystemClock(),
        ids: new UuidIdGenerator(),
        hasher,
        tokens: new CryptoSessionTokenService(),
        policy: DEFAULT_SESSION_POLICY,
      };
      const create = new CreateUser(deps);
      const input = { actor, email: "ana@example.test", displayName: "Ana", password: PASSWORD };
      const results = await Promise.all([create.execute(input), create.execute(input)]);
      const codes = results.map((r) => (r.ok ? "ok" : r.error.code)).sort();
      expect(codes).toEqual(["email_taken", "ok"]);
      const audit = await sql`select 1 from audit_log where action = 'user.create'`;
      expect(audit).toHaveLength(1);
      expect((await sql`select count(*)::int as n from users`)[0]?.n).toBe(2);
    });
  });

  it("lets exactly one of several concurrent installs succeed", async () => {
    await withDb(async (sql) => {
      // The gate makes every install read the tenant table before any of them writes.
      const gate = makeGate(4, 400);
      const deps: IdentityDeps = {
        unitOfWork: new PostgresUnitOfWork(sql, (handle) => {
          const tx = createPostgresIdentityTx(handle);
          return { ...tx, tenants: gatedTenants(tx.tenants, gate) };
        }),
        clock: new SystemClock(),
        ids: new UuidIdGenerator(),
        hasher,
        tokens: new CryptoSessionTokenService(),
        policy: DEFAULT_SESSION_POLICY,
      };
      const install = new InstallTenantAdmin(deps);
      const runs = Array.from({ length: 4 }, (_, i) =>
        install.execute({ ...installInput, email: `admin${String(i)}@example.test` }),
      );
      const results = await Promise.all(runs);
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const codes = results.map((r) => (r.ok ? "ok" : r.error.code));
      expect(codes.filter((code) => code !== "ok")).toEqual(Array.from({ length: 3 }, () => "tenant_already_installed"));
      expect((await sql`select count(*)::int as n from tenants`)[0]?.n).toBe(1);
      expect((await sql`select count(*)::int as n from users`)[0]?.n).toBe(1);
    });
  });

  it("runs the whole identity flow end to end with the real hasher", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      const installed = must(await c.identity.install.execute(installInput));
      const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
      const actor = must(await c.identity.authenticate.execute({ token: signed.token }));
      const anaPassword = "another-long-password";
      const ana = must(
        await c.identity.createUser.execute({ actor, email: "ana@example.test", displayName: "Ana", password: anaPassword }),
      );
      const scope = { type: "tenant", id: installed.tenant.id } as const;
      must(
        await c.identity.assignRole.execute({ actor, userId: ana.id, role: "viewer", scope, reason: "initial access" }),
      );
      const anaSession = must(await c.identity.signIn.execute({ email: "ana@example.test", password: anaPassword }));
      expect(must(await c.identity.authenticate.execute({ token: anaSession.token })).assignments).toHaveLength(1);
      must(await c.identity.deactivateUser.execute({ actor, userId: ana.id, reason: "left the company" }));
      const rejected = await c.identity.authenticate.execute({ token: anaSession.token });
      expect(rejected.ok).toBe(false);
      const actions = await sql<{ action: string }[]>`select action from audit_log order by id`;
      expect(actions.map((r) => r.action)).toEqual([
        "identity.install",
        "auth.sign_in",
        "user.create",
        "role.assign",
        "auth.sign_in",
        "user.deactivate",
      ]);
      for (const secret of [PASSWORD, anaPassword, signed.token, anaSession.token]) {
        const hits = await sql`select 1 from audit_log a where a::text like ${"%" + secret + "%"}`;
        expect(hits).toHaveLength(0);
      }
    });
  });
});
