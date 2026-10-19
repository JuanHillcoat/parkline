import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import type { Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });
const MISSING = "00000000-0000-4000-8000-000000000000";

let admin: Sql;
let owner: Sql;
let app: Sql;
let c: Container;
let tenantId = "";
const ids: Record<string, string | undefined> = {};

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  owner = postgres(url.toString(), { max: 2, onnotice: () => undefined });
  await migrate(owner, MIGRATIONS_DIR);
  // Every connection of the application runs as the restricted role.
  app = postgres(url.toString(), { max: 6, onnotice: () => undefined, connection: { role: "parkline_app" } });
  c = createContainer(app, { hasher });
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

const credentials = (email: string) => ({ email, password: PASSWORD });
const context = async (email: string) =>
  must(await c.identity.authenticate.execute({ token: must(await c.identity.signIn.execute(credentials(email))).token }));
const actorOf = async (email: string): Promise<Actor> => toActor(await context(email));
const names = (rows: readonly { name: string }[]): string[] => rows.map((row) => row.name);

const newManager = async (email: string, scope: { type: string; id: string }) =>
  c.identity.createUser.execute({
    actor: await context("admin@example.test"),
    email,
    displayName: "Synthetic Manager",
    password: PASSWORD,
    role: "manager",
    scope,
  });

describe("roles with scope through the container as parkline_app", () => {
  it("builds a small organization and an analyst that archives", async () => {
    const installed = must(
      await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials("admin@example.test") }),
    );
    tenantId = installed.tenant.id;
    const actor = await actorOf("admin@example.test");
    const o = c.organization;
    ids.divA = must(await o.createBusinessUnit.execute({ actor, name: "Division A" })).id;
    ids.divB = must(await o.createBusinessUnit.execute({ actor, name: "Division B" })).id;
    ids.divOld = must(await o.createBusinessUnit.execute({ actor, name: "Division Old" })).id;
    for (const [key, name] of [["site1", "Site 1"], ["site2", "Site 2"], ["site3", "Site 3"]] as const) {
      ids[key] = must(await o.createSite.execute({ actor, name })).id;
    }
    const op = async (key: string, division: string, site: string, name: string, costCenter: string) => {
      ids[key] = must(await o.createOperation.execute({ actor, businessUnitId: division, siteId: site, name, costCenter })).id;
    };
    await op("opA1", ids.divA, ids.site1 ?? "", "Operation A1", "0050");
    await op("opA2", ids.divA, ids.site2 ?? "", "Operation A2", "0051");
    await op("opB1", ids.divB, ids.site3 ?? "", "Operation B1", "0060");
    const created = await c.identity.createUser.execute({
      actor: await context("admin@example.test"),
      email: "analyst@example.test",
      displayName: "Synthetic Analyst",
      password: PASSWORD,
      role: "fleet_analyst",
    });
    must(created);
    const analyst = await actorOf("analyst@example.test");
    must(await o.archiveBusinessUnit.execute({ actor: analyst, id: ids.divOld, reason: "Synthetic archive" }));
  });

  it("creates managers scoped to an operation and to a division, with the typed columns filled", async () => {
    must(await newManager("op.manager@example.test", { type: "operation", id: ids.opA1 ?? "" }));
    must(await newManager("div.manager@example.test", { type: "business_unit", id: ids.divA ?? "" }));
    const rows = await owner<{ email: string; scope_type: string; scope_id: string; unit: string | null; op: string | null; site: string | null }[]>`
      select u.email, a.scope_type, a.scope_id, a.scope_business_unit_id as unit, a.scope_operation_id as op, a.scope_site_id as site
      from user_role_assignments a join users u on u.id = a.user_id
      where a.role = 'manager' and a.active order by u.email`;
    expect(rows).toEqual([
      { email: "div.manager@example.test", scope_type: "business_unit", scope_id: ids.divA, unit: ids.divA, op: null, site: null },
      { email: "op.manager@example.test", scope_type: "operation", scope_id: ids.opA1, unit: null, op: ids.opA1, site: null },
    ]);
  });

  it("shows the operation manager only its operation and its site", async () => {
    const actor = await actorOf("op.manager@example.test");
    const o = c.organization;
    expect(must(await o.listOperations.execute({ actor })).map((op) => op.id)).toEqual([ids.opA1]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["SITE 1"]);
    expect(must(await o.listBusinessUnits.execute({ actor }))).toEqual([]);
  });

  it("shows the division manager every operation of its division and nothing of another one", async () => {
    const actor = await actorOf("div.manager@example.test");
    const o = c.organization;
    expect(names(must(await o.listOperations.execute({ actor })))).toEqual(["OPERATION A1", "OPERATION A2"]);
    expect(names(must(await o.listBusinessUnits.execute({ actor })))).toEqual(["DIVISION A"]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["SITE 1", "SITE 2"]);
  });

  it("refuses archived, foreign, missing and malformed scopes with typed errors, and an admin with a narrower scope", async () => {
    const [foreignTenant] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Other Tenant') returning id`;
    const [foreign] = await owner<{ id: string }[]>`
      insert into business_units (id, tenant_id, name) values (gen_random_uuid(), ${foreignTenant?.id ?? ""}, 'Foreign Division') returning id`;
    const attempts: [string, string, string][] = [
      ["archived", "business_unit", ids.divOld ?? ""],
      ["foreign", "business_unit", foreign?.id ?? ""],
      ["missing", "operation", MISSING],
      ["malformed", "site", "not-a-uuid"],
      ["other level", "operation", ids.divA ?? ""],
    ];
    for (const [label, type, id] of attempts) {
      const result = await newManager(`${label.replace(" ", ".")}@example.test`, { type, id });
      expect(!result.ok && result.error.code, label).toBe("scope_not_found");
    }
    const narrowAdmin = await c.identity.createUser.execute({
      actor: await context("admin@example.test"), email: "narrow.admin@example.test", displayName: "Narrow",
      password: PASSWORD, role: "admin", scope: { type: "business_unit", id: ids.divA ?? "" },
    });
    expect(!narrowAdmin.ok && narrowAdmin.error.code).toBe("scope_not_allowed_for_role");
    const created = await owner`select 1 from users where email like '%@example.test' and email not in
      ('admin@example.test', 'analyst@example.test', 'op.manager@example.test', 'div.manager@example.test')`;
    expect(created).toHaveLength(0);
  });

  it("changes a role to another scope, replaces the old assignment and audits both scopes with the name and the reason", async () => {
    const manager = must(await c.identity.listUsers.execute({ actor: await context("admin@example.test") })).find(
      (u) => u.email === "op.manager@example.test",
    );
    const changed = await c.identity.changeUserRole.execute({
      actor: await context("admin@example.test"), userId: manager?.id ?? "", newRole: "manager",
      scope: { type: "operation", id: ids.opB1 ?? "" }, reason: "Moved to division B",
    });
    must(changed);
    const active = await owner<{ scope_id: string }[]>`
      select scope_id from user_role_assignments where user_id = ${manager?.id ?? ""} and active`;
    expect(active.map((r) => r.scope_id)).toEqual([ids.opB1]);
    const [entry] = await owner<{ reason: string; before: unknown; after: unknown }[]>`
      select reason, before, after from audit_log where action = 'role.change' and entity_id = ${manager?.id ?? ""}`;
    expect(entry?.reason).toBe("Moved to division B");
    expect(entry?.before).toEqual({ roles: [{ role: "manager", scope: { type: "operation", id: ids.opA1 } }] });
    expect(entry?.after).toEqual({
      roles: [{ role: "manager", scope: { type: "operation", id: ids.opB1 }, scopeName: "0060 OPERATION B1" }],
    });
    const refused = await c.identity.changeUserRole.execute({
      actor: await context("admin@example.test"), userId: manager?.id ?? "", newRole: "manager",
      scope: { type: "business_unit", id: ids.divOld ?? "" }, reason: "Archived target",
    });
    expect(!refused.ok && refused.error.code).toBe("scope_not_found");
  });

  it("lists users with the scope label in one pass, and flags an archived scope", async () => {
    const users = must(await c.identity.listUsers.execute({ actor: await context("admin@example.test") }));
    const grant = (email: string) => users.find((u) => u.email === email)?.grants[0];
    expect(grant("div.manager@example.test")).toEqual({
      role: "manager", scopeType: "business_unit", scopeId: ids.divA, scopeLabel: { name: "DIVISION A", archived: false },
    });
    expect(grant("op.manager@example.test")?.scopeLabel).toEqual({ name: "0060 OPERATION B1", archived: false });
    expect(grant("admin@example.test")).toMatchObject({ scopeType: "tenant", scopeLabel: null });
    const analyst = await actorOf("analyst@example.test");
    must(await c.organization.archiveOperation.execute({ actor: analyst, id: ids.opB1 ?? "", reason: "Synthetic archive" }));
    const after = must(await c.identity.listUsers.execute({ actor: await context("admin@example.test") }));
    expect(after.find((u) => u.email === "op.manager@example.test")?.grants[0]?.scopeLabel?.archived).toBe(true);
  });

  it("writes the user.create audit entry with the scope and its name", async () => {
    const [entry] = await owner<{ after: unknown }[]>`
      select after from audit_log where action = 'user.create' and after->>'email' = 'div.manager@example.test'`;
    expect(entry?.after).toMatchObject({
      roles: [{ role: "manager", scope: { type: "business_unit", id: ids.divA }, scopeName: "DIVISION A" }],
    });
    expect(tenantId).not.toBe("");
  });
});
