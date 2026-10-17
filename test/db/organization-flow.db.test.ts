import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import { createRoleAssignment } from "../../src/identity/domain/role-assignment";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import { PostgresRoleAssignmentRepository } from "../../src/identity/infrastructure/postgres-role-assignment-repository";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import type { AuditLog } from "../../src/shared/domain/ports/audit-log";
import type { Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });

let admin: Sql;
let owner: Sql;
let app: Sql;
let c: Container;
let adminActor: Actor;
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

async function signInActor(email: string): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute(credentials(email)));
  return toActor(must(await c.identity.authenticate.execute({ token: signed.token })));
}

async function createAnalyst(email: string): Promise<string> {
  const context = must(await c.identity.authenticate.execute({ token: await adminToken() }));
  const user = must(
    await c.identity.createUser.execute({
      actor: context,
      email,
      displayName: "Synthetic Analyst",
      password: PASSWORD,
      role: "fleet_analyst",
    }),
  );
  return user.id;
}

const adminToken = async (): Promise<string> =>
  must(await c.identity.signIn.execute(credentials("admin@example.test"))).token;

/**
 * The identity use case only assigns the tenant scope today, so the test swaps the analyst's
 * tenant assignment for an operation scope through the identity repository, as the future
 * scope-assignment feature will.
 */
async function scopeToOperation(userId: string, operationId: string): Promise<void> {
  await app.begin(async (handle) => {
    const repository = new PostgresRoleAssignmentRepository(handle);
    const tenantGrant = createRoleAssignment({ userId, role: "fleet_analyst", scope: { type: "tenant", id: tenantId } });
    const operationGrant = createRoleAssignment({ userId, role: "fleet_analyst", scope: { type: "operation", id: operationId } });
    await repository.deactivate(tenantId, must(tenantGrant));
    await repository.add(tenantId, must(operationGrant));
  });
}

const names = (rows: readonly { name: string }[]): string[] => rows.map((row) => row.name);

describe("organization flow through the container as parkline_app", () => {
  it("builds the structure: divisions, operations, sites, links and a rename", async () => {
    const installed = must(
      await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials("admin@example.test") }),
    );
    tenantId = installed.tenant.id;
    adminActor = await signInActor("admin@example.test");
    const o = c.organization;
    ids.divA = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Division A" })).id;
    ids.divB = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Division B" })).id;
    ids.opA1 = must(await o.createOperation.execute({ actor: adminActor, businessUnitId: ids.divA, name: "Operation A1" })).id;
    ids.opA2 = must(await o.createOperation.execute({ actor: adminActor, businessUnitId: ids.divA, name: "Operation A2" })).id;
    ids.opB1 = must(await o.createOperation.execute({ actor: adminActor, businessUnitId: ids.divB, name: "Operation B1" })).id;
    ids.site1 = must(await o.createSite.execute({ actor: adminActor, name: "Site 1" })).id;
    ids.site2 = must(await o.createSite.execute({ actor: adminActor, name: "Site 2" })).id;
    ids.site3 = must(await o.createSite.execute({ actor: adminActor, name: "Site 3" })).id;
    for (const [op, site] of [["opA1", "site1"], ["opA1", "site2"], ["opB1", "site3"]] as const) {
      must(await o.linkOperationSite.execute({ actor: adminActor, operationId: ids[op] ?? "", siteId: ids[site] ?? "" }));
    }
    must(await o.renameSite.execute({ actor: adminActor, id: ids.site2, name: "Site Two" }));
    must(await o.renameBusinessUnit.execute({ actor: adminActor, id: ids.divB, name: "Division Bravo" }));
    must(await o.renameOperation.execute({ actor: adminActor, id: ids.opB1, name: "Operation Bravo 1" }));
  });

  it("returns typed conflicts for duplicate names and allows the same operation name in two divisions", async () => {
    const o = c.organization;
    const dup = await o.createBusinessUnit.execute({ actor: adminActor, name: "  division   a " });
    expect(!dup.ok && dup.error.code).toBe("name_taken");
    const twin = await o.createOperation.execute({ actor: adminActor, businessUnitId: ids.divB ?? "", name: "operation a1" });
    expect(twin.ok).toBe(true);
    const sameDivision = await o.createOperation.execute({ actor: adminActor, businessUnitId: ids.divA ?? "", name: "OPERATION A1" });
    expect(!sameDivision.ok && sameDivision.error.code).toBe("name_taken");
    const again = await o.linkOperationSite.execute({ actor: adminActor, operationId: ids.opA1 ?? "", siteId: ids.site1 ?? "" });
    expect(!again.ok && again.error.code).toBe("already_linked");
  });

  it("lists everything for a tenant-scoped analyst", async () => {
    await createAnalyst("tenant.analyst@example.test");
    const actor = await signInActor("tenant.analyst@example.test");
    const o = c.organization;
    expect(names(must(await o.listBusinessUnits.execute({ actor })))).toEqual(["Division A", "Division Bravo"]);
    // Two operations share the key "operation a1" (one per division); their tie order is by id.
    const operations = names(must(await o.listOperations.execute({ actor }))).map((name) => name.toLowerCase());
    expect(operations).toEqual(["operation a1", "operation a1", "operation a2", "operation bravo 1"]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["Site 1", "Site 3", "Site Two"]);
  });

  it("shows an operation-scoped analyst only its operation and the sites linked to it", async () => {
    const userId = await createAnalyst("operation.analyst@example.test");
    await scopeToOperation(userId, ids.opA1 ?? "");
    const actor = await signInActor("operation.analyst@example.test");
    const o = c.organization;
    expect(must(await o.listOperations.execute({ actor })).map((op) => op.id)).toEqual([ids.opA1]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["Site 1", "Site Two"]);
    expect(must(await o.listBusinessUnits.execute({ actor }))).toEqual([]);
    const denied = await o.createSite.execute({ actor, name: "Not Allowed" });
    expect(denied.ok).toBe(false);
  });

  it("wrote one audit entry per mutation with the right action", async () => {
    const rows = await owner<{ action: string; entity_type: string }[]>`
      select action, entity_type from audit_log where action like 'organization.%' order by id`;
    const seen = rows.map((row) => `${row.action}:${row.entity_type}`);
    expect(seen).toEqual([
      "organization.business_unit.create:business_unit",
      "organization.business_unit.create:business_unit",
      "organization.operation.create:operation",
      "organization.operation.create:operation",
      "organization.operation.create:operation",
      "organization.site.create:site",
      "organization.site.create:site",
      "organization.site.create:site",
      "organization.link:operation_site",
      "organization.link:operation_site",
      "organization.link:operation_site",
      "organization.rename:site",
      "organization.rename:business_unit",
      "organization.rename:operation",
      "organization.operation.create:operation",
    ]);
  });

  it("rolls the business change back when the audit write fails (create and rename)", async () => {
    const failing: AuditLog = { record: () => Promise.reject(new Error("audit unavailable")) };
    const broken = createContainer(app, { hasher, wrapAudit: () => failing });
    const count = async (table: string) => Number((await owner.unsafe(`select count(*)::int as n from ${table}`))[0]?.n);
    const before = await count("business_units");
    await expect(broken.organization.createBusinessUnit.execute({ actor: adminActor, name: "Never Persisted" })).rejects.toThrow(
      /audit unavailable/,
    );
    await expect(broken.organization.renameSite.execute({ actor: adminActor, id: ids.site1 ?? "", name: "Never Renamed" })).rejects.toThrow(
      /audit unavailable/,
    );
    expect(await count("business_units")).toBe(before);
    const site = await owner<{ name: string }[]>`select name from sites where id = ${ids.site1 ?? ""}`;
    expect(site[0]?.name).toBe("Site 1");
  });

  it("identity adapter fills the typed scope column, reads the scope back unchanged and refuses missing targets", async () => {
    const userId = await createAnalyst("typed.scope@example.test");
    const grant = (type: "site" | "business_unit", id: string) =>
      must(createRoleAssignment({ userId, role: "viewer", scope: { type, id } }));
    const add = (type: "site" | "business_unit", id: string) =>
      app.begin((handle) => new PostgresRoleAssignmentRepository(handle).add(tenantId, grant(type, id)));
    await add("site", ids.site1 ?? "");
    await add("business_unit", ids.divA ?? "");
    const rows = await owner<{ scope_type: string; scope_id: string; site: string | null; unit: string | null }[]>`
      select scope_type, scope_id, scope_site_id as site, scope_business_unit_id as unit
      from user_role_assignments where user_id = ${userId} and role = 'viewer' order by scope_type`;
    expect(rows).toEqual([
      { scope_type: "business_unit", scope_id: ids.divA, site: null, unit: ids.divA },
      { scope_type: "site", scope_id: ids.site1, site: ids.site1, unit: null },
    ]);
    const read = await app.begin((handle) => new PostgresRoleAssignmentRepository(handle).listActiveByUser(tenantId, userId));
    expect(read.map((a) => a.scope)).toEqual(
      expect.arrayContaining([
        { type: "site", id: ids.site1 },
        { type: "business_unit", id: ids.divA },
      ]),
    );
    const missing = await add("site", "00000000-0000-4000-8000-000000000000").catch((e: unknown) => e as { code?: string });
    expect((missing as { code?: string }).code).toBe("23503");
  });

  it("two concurrent creates of the same name leave exactly one row", async () => {
    const attempts = await Promise.allSettled([
      c.organization.createSite.execute({ actor: adminActor, name: "Racing Site" }),
      c.organization.createSite.execute({ actor: adminActor, name: "racing  site" }),
    ]);
    const created = attempts.filter((a) => a.status === "fulfilled" && a.value.ok);
    expect(created).toHaveLength(1);
    const rows = await owner`select 1 from sites where name_key = 'racing site'`;
    expect(rows).toHaveLength(1);
  });
});
