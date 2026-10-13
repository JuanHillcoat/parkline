import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import type { Result } from "../../src/shared/domain/result";
import { ok } from "../../src/shared/domain/result";
import { PostgresAuditLog } from "../../src/shared/infrastructure/postgres-audit-log";
import { PostgresUnitOfWork } from "../../src/shared/infrastructure/postgres-unit-of-work";
import { createContainer } from "../../src/shared/infrastructure/container";
import type { IdentityTx } from "../../src/identity/application/ports/identity-tx";
import { createRoleAssignment } from "../../src/identity/domain/role-assignment";
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

const newUser = (tenantId: string, email: string, displayName: string): User => ({
  id: randomUUID(),
  tenantId,
  email,
  displayName,
  active: true,
});

describe("identity list queries on Postgres", () => {
  it("listByTenant and listActiveByTenant are tenant scoped", async () => {
    await withDb(async (sql) => {
      const a = { id: randomUUID(), name: "Tenant A" };
      const b = { id: randomUUID(), name: "Tenant B" };
      const zed = newUser(a.id, "zed@example.test", "Zed");
      const ana = newUser(a.id, "ana@example.test", "ana");
      const bia = newUser(b.id, "bia@example.test", "Bia");
      const grant = (user: User, tenantId: string, role: "viewer" | "manager") =>
        must(createRoleAssignment({ userId: user.id, role, scope: { type: "tenant", id: tenantId } }));
      const result = await uow(sql).run(async (tx) => {
        await tx.tenants.add(a);
        await tx.tenants.add(b);
        for (const user of [zed, ana, bia]) await tx.users.add(user, "stored-hash");
        await tx.assignments.add(a.id, grant(zed, a.id, "viewer"));
        await tx.assignments.add(a.id, grant(ana, a.id, "manager"));
        await tx.assignments.add(b.id, grant(bia, b.id, "viewer"));
        await tx.assignments.deactivate(a.id, grant(zed, a.id, "viewer"));
        return ok({
          usersA: await tx.users.listByTenant(a.id),
          usersB: await tx.users.listByTenant(b.id),
          rolesA: await tx.assignments.listActiveByTenant(a.id),
          rolesB: await tx.assignments.listActiveByTenant(b.id),
        });
      });
      const state = must(result);
      expect(state.usersA.map((u) => u.email)).toEqual(["ana@example.test", "zed@example.test"]);
      expect(state.usersB.map((u) => u.email)).toEqual(["bia@example.test"]);
      expect(state.rolesA.map((r) => [r.userId, r.role])).toEqual([[ana.id, "manager"]]);
      expect(state.rolesB.map((r) => r.userId)).toEqual([bia.id]);
    });
  });

  it("ChangeUserRole leaves one active assignment and one role.change audit row", async () => {
    await withDb(async (sql) => {
      const c = createContainer(sql, { hasher });
      must(
        await c.identity.install.execute({
          tenantName: "Synthetic Tenant",
          email: "admin@example.test",
          displayName: "Synthetic Admin",
          password: PASSWORD,
        }),
      );
      const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
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
      const rows = await sql<{ role: string }[]>`
        select role from user_role_assignments where user_id = ${ana.id} and active`;
      expect(rows.map((r) => r.role)).toEqual(["manager"]);
      const audit = await sql`select reason from audit_log where action = 'role.change'`;
      expect(audit).toHaveLength(1);
      expect(audit[0]?.reason).toBe("promoted to manager");
      const listed = must(await c.identity.listUsers.execute({ actor }));
      expect(listed.find((u) => u.id === ana.id)?.roles).toEqual(["manager"]);
    });
  });
});
