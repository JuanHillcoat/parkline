import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import { createRoleAssignment } from "../../src/identity/domain/role-assignment";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import { PostgresRoleAssignmentRepository } from "../../src/identity/infrastructure/postgres-role-assignment-repository";
import type { UpdateOperationInput } from "../../src/organization/application/use-cases/update-operation";
import type { Operation } from "../../src/organization/domain/entities";
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
 * tenant assignment for another scope through the identity repository, as the future
 * scope-assignment feature will.
 */
async function scopeTo(userId: string, type: "operation" | "business_unit" | "site", id: string): Promise<void> {
  await app.begin(async (handle) => {
    const repository = new PostgresRoleAssignmentRepository(handle);
    const tenantGrant = createRoleAssignment({ userId, role: "fleet_analyst", scope: { type: "tenant", id: tenantId } });
    const scopedGrant = createRoleAssignment({ userId, role: "fleet_analyst", scope: { type, id } });
    await repository.deactivate(tenantId, must(tenantGrant));
    await repository.add(tenantId, must(scopedGrant));
  });
}

const names = (rows: readonly { name: string }[]): string[] => rows.map((row) => row.name);

describe("organization flow through the container as parkline_app", () => {
  const createOp = (businessUnitId: string, siteId: string, name: string, costCenter: string) =>
    c.organization.createOperation.execute({ actor: adminActor, businessUnitId, siteId, name, costCenter });

  it("builds the structure: divisions, sites, operations with one site and a cost center, and renames", async () => {
    const installed = must(
      await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials("admin@example.test") }),
    );
    tenantId = installed.tenant.id;
    adminActor = await signInActor("admin@example.test");
    const o = c.organization;
    ids.divA = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Division A" })).id;
    ids.divB = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Division B" })).id;
    ids.site1 = must(await o.createSite.execute({ actor: adminActor, name: "Site 1" })).id;
    ids.site2 = must(await o.createSite.execute({ actor: adminActor, name: "Site 2" })).id;
    ids.site3 = must(await o.createSite.execute({ actor: adminActor, name: "Site 3" })).id;
    ids.opA1 = must(await createOp(ids.divA, ids.site1, "Operation A1", "0001")).id;
    ids.opA2 = must(await createOp(ids.divA, ids.site2, "Operation A2", "0002")).id;
    ids.opB1 = must(await createOp(ids.divB, ids.site3, "Operation B1", "0003")).id;
    must(await o.renameSite.execute({ actor: adminActor, id: ids.site2, name: "Site Two" }));
    must(await o.renameBusinessUnit.execute({ actor: adminActor, id: ids.divB, name: "Division Bravo" }));
    must(await o.renameOperation.execute({ actor: adminActor, id: ids.opB1, name: "Operation Bravo 1" }));
    const stored = await owner<{ cost_center: string; site_id: string }[]>`
      select cost_center, site_id from operations where id = ${ids.opA1}`;
    expect(stored[0]).toEqual({ cost_center: "0001", site_id: ids.site1 });
  });

  it("returns typed conflicts and validation errors, and allows the same operation name in two divisions", async () => {
    const o = c.organization;
    const dup = await o.createBusinessUnit.execute({ actor: adminActor, name: "  division   a " });
    expect(!dup.ok && dup.error.code).toBe("name_taken");
    const twin = await createOp(ids.divB ?? "", ids.site1 ?? "", "operation a1", "0004");
    expect(twin.ok).toBe(true);
    const sameDivision = await createOp(ids.divA ?? "", ids.site1 ?? "", "OPERATION A1", "0005");
    expect(!sameDivision.ok && sameDivision.error.code).toBe("name_taken");
    const sameCode = await createOp(ids.divB ?? "", ids.site3 ?? "", "Operation B9", " 0001 ");
    expect(!sameCode.ok && sameCode.error.code).toBe("cost_center_taken");
    const badCode = await createOp(ids.divB ?? "", ids.site3 ?? "", "Operation B9", "50");
    expect(!badCode.ok && badCode.error.code).toBe("invalid_cost_center");
    const noSite = await createOp(ids.divB ?? "", "00000000-0000-4000-8000-000000000000", "Operation B9", "0009");
    expect(!noSite.ok && noSite.error.code).toBe("not_found");
    const noDivision = await createOp("not-a-uuid", ids.site3 ?? "", "Operation B9", "0009");
    expect(!noDivision.ok && noDivision.error.code).toBe("not_found");
  });

  it("lists everything for a tenant-scoped analyst", async () => {
    await createAnalyst("tenant.analyst@example.test");
    const actor = await signInActor("tenant.analyst@example.test");
    const o = c.organization;
    expect(names(must(await o.listBusinessUnits.execute({ actor })))).toEqual(["DIVISION A", "DIVISION BRAVO"]);
    // Two operations share the name "OPERATION A1" (one per division); their tie order is by id.
    expect(names(must(await o.listOperations.execute({ actor })))).toEqual([
      "OPERATION A1",
      "OPERATION A1",
      "OPERATION A2",
      "OPERATION BRAVO 1",
    ]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["SITE 1", "SITE 3", "SITE TWO"]);
  });

  it("shows a division-scoped analyst its division, its operations and their sites", async () => {
    const userId = await createAnalyst("division.analyst@example.test");
    await scopeTo(userId, "business_unit", ids.divA ?? "");
    const actor = await signInActor("division.analyst@example.test");
    const o = c.organization;
    expect(names(must(await o.listBusinessUnits.execute({ actor })))).toEqual(["DIVISION A"]);
    expect(names(must(await o.listOperations.execute({ actor })))).toEqual(["OPERATION A1", "OPERATION A2"]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["SITE 1", "SITE TWO"]);
    expect((await o.createSite.execute({ actor, name: "Not Allowed" })).ok).toBe(false);
    const own = await o.createOperation.execute({ actor, businessUnitId: ids.divA ?? "", siteId: ids.site3 ?? "", name: "Operation A9", costCenter: "0090" });
    expect(own.ok).toBe(true);
    const other = await o.createOperation.execute({ actor, businessUnitId: ids.divB ?? "", siteId: ids.site3 ?? "", name: "Operation B8", costCenter: "0091" });
    expect(!other.ok && other.error.code).toBe("forbidden");
  });

  it("shows a site-scoped analyst the site and the operations located at it, and cannot create", async () => {
    const userId = await createAnalyst("site.analyst@example.test");
    await scopeTo(userId, "site", ids.site1 ?? "");
    const actor = await signInActor("site.analyst@example.test");
    const o = c.organization;
    expect(must(await o.listBusinessUnits.execute({ actor }))).toEqual([]);
    expect(names(must(await o.listOperations.execute({ actor })))).toEqual(["OPERATION A1", "OPERATION A1"]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["SITE 1"]);
    const denied = await o.createOperation.execute({ actor, businessUnitId: ids.divA ?? "", siteId: ids.site1 ?? "", name: "Operation A8", costCenter: "0092" });
    expect(!denied.ok && denied.error.code).toBe("forbidden");
  });

  it("shows an operation-scoped analyst only its operation and its site", async () => {
    const userId = await createAnalyst("operation.analyst@example.test");
    await scopeTo(userId, "operation", ids.opA1 ?? "");
    const actor = await signInActor("operation.analyst@example.test");
    const o = c.organization;
    expect(must(await o.listOperations.execute({ actor })).map((op) => op.id)).toEqual([ids.opA1]);
    expect(names(must(await o.listSites.execute({ actor })))).toEqual(["SITE 1"]);
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
      "organization.site.create:site",
      "organization.site.create:site",
      "organization.site.create:site",
      "organization.operation.create:operation",
      "organization.operation.create:operation",
      "organization.operation.create:operation",
      "organization.rename:site",
      "organization.rename:business_unit",
      "organization.rename:operation",
      "organization.operation.create:operation",
      "organization.operation.create:operation",
    ]);
    expect(seen).not.toContain("organization.link:operation_site");
    const created = await owner<{ after: { costCenter: string; siteId: string } }[]>`
      select after from audit_log where action = 'organization.operation.create' order by id limit 1`;
    expect(created[0]?.after).toMatchObject({ costCenter: "0001", siteId: ids.site1 });
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
    expect(site[0]?.name).toBe("SITE 1");
  });

  it("stores names uppercase with their accents and treats accent and case variants as the same name", async () => {
    const o = c.organization;
    const unit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "  bahía   blanca " }));
    const site = must(await o.createSite.execute({ actor: adminActor, name: "Bahía Blanca" }));
    const operation = must(await createOp(unit.id, site.id, "bahía blanca", "0710"));
    expect([unit.name, site.name, operation.name]).toEqual(["BAHÍA BLANCA", "BAHÍA BLANCA", "BAHÍA BLANCA"]);
    const stored = await owner<{ name: string; name_key: string }[]>`
      select name, name_key from sites where id = ${site.id}`;
    expect(stored[0]).toEqual({ name: "BAHÍA BLANCA", name_key: "BAHIA BLANCA" });
    for (const variant of ["BAHIA BLANCA", "Bahia  Blanca", "bahía blanca"]) {
      const dupUnit = await o.createBusinessUnit.execute({ actor: adminActor, name: variant });
      const dupSite = await o.createSite.execute({ actor: adminActor, name: variant });
      const dupOp = await createOp(unit.id, site.id, variant, "0711");
      expect(!dupUnit.ok && dupUnit.error.code, variant).toBe("name_taken");
      expect(!dupSite.ok && dupSite.error.code, variant).toBe("name_taken");
      expect(!dupOp.ok && dupOp.error.code, variant).toBe("name_taken");
    }
    const otherUnit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Otra division" }));
    expect((await createOp(otherUnit.id, site.id, "BAHIA BLANCA", "0712")).ok).toBe(true);
    const tilde = await Promise.all([
      o.createSite.execute({ actor: adminActor, name: "Núñez" }),
      o.createSite.execute({ actor: adminActor, name: "Nunez" }),
    ]);
    expect(tilde.every((result) => result.ok)).toBe(true);
  });

  it("two concurrent creates of accent variants of one name give one ok and one typed conflict", async () => {
    const o = c.organization;
    for (let round = 0; round < 8; round += 1) {
      const outcome = await Promise.allSettled([
        o.createSite.execute({ actor: adminActor, name: `Camión ${String(round)}` }),
        o.createSite.execute({ actor: adminActor, name: `CAMION  ${String(round)}` }),
      ]);
      const codes = outcome.map((a) => (a.status === "rejected" ? "rejected" : a.value.ok ? "ok" : a.value.error.code));
      expect(codes.sort()).toEqual(["name_taken", "ok"]);
    }
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

  /** Both attempts must resolve to a Result: exactly one ok and one typed `name_taken`, never a rejection. */
  const expectOneWinner = (
    attempts: PromiseSettledResult<Result<unknown, { code: string }>>[],
    conflict = "name_taken",
  ): void => {
    const outcomes = attempts.map((attempt) => {
      if (attempt.status === "rejected") return `rejected: ${JSON.stringify(attempt.reason)}`;
      return attempt.value.ok ? "ok" : attempt.value.error.code;
    });
    expect(outcomes.sort()).toEqual([conflict, "ok"].sort());
  };

  it("two concurrent creates of the same name give one ok and one typed conflict, over several rounds", async () => {
    const o = c.organization;
    for (let round = 0; round < 8; round += 1) {
      const key = `racing ${String(round)}`;
      const site = await Promise.allSettled([
        o.createSite.execute({ actor: adminActor, name: `Racing Site ${String(round)}` }),
        o.createSite.execute({ actor: adminActor, name: `racing  site ${String(round)}` }),
      ]);
      expectOneWinner(site);
      const unit = await Promise.allSettled([
        o.createBusinessUnit.execute({ actor: adminActor, name: `Racing Unit ${key}` }),
        o.createBusinessUnit.execute({ actor: adminActor, name: `racing  unit ${key}` }),
      ]);
      expectOneWinner(unit);
      const operation = await Promise.allSettled([
        createOp(ids.divA ?? "", ids.site1 ?? "", `Racing Op ${key}`, `20${String(round)}0`),
        createOp(ids.divA ?? "", ids.site2 ?? "", `racing  op ${key}`, `20${String(round)}1`),
      ]);
      expectOneWinner(operation);
    }
    const rows = await owner`select 1 from sites where name_key like 'RACING SITE %'`;
    expect(rows).toHaveLength(8);
    const operations = await owner`select 1 from operations where name_key like 'RACING OP %'`;
    expect(operations).toHaveLength(8);
  });

  it("two concurrent creates with the same cost center give one ok and one typed conflict, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const code = `40${String(round)}0`;
      expectOneWinner(
        await Promise.allSettled([
          createOp(ids.divA ?? "", ids.site1 ?? "", `Code Race A ${String(round)}`, code),
          createOp(ids.divB ?? "", ids.site3 ?? "", `Code Race B ${String(round)}`, ` ${code} `),
        ]),
        "cost_center_taken",
      );
      const rows = await owner`select 1 from operations where cost_center = ${code}`;
      expect(rows).toHaveLength(1);
    }
  });

  it("a create that breaks both unique indexes at once still answers a typed conflict", async () => {
    const result = await createOp(ids.divA ?? "", ids.site1 ?? "", "Operation A1", "0001");
    expect(!result.ok && ["name_taken", "cost_center_taken"].includes(result.error.code)).toBe(true);
  });

  it("two concurrent renames into the same name give one ok and one typed conflict, over several rounds", async () => {
    const o = c.organization;
    for (let round = 0; round < 8; round += 1) {
      const a = must(await o.createSite.execute({ actor: adminActor, name: `Rename Source A ${String(round)}` })).id;
      const b = must(await o.createSite.execute({ actor: adminActor, name: `Rename Source B ${String(round)}` })).id;
      const target = `Rename Target ${String(round)}`;
      expectOneWinner(
        await Promise.allSettled([
          o.renameSite.execute({ actor: adminActor, id: a, name: target }),
          o.renameSite.execute({ actor: adminActor, id: b, name: target.toUpperCase() }),
        ]),
      );
    }
  });

  const edit = (actor: Actor, op: Operation, overrides: Partial<UpdateOperationInput> = {}) =>
    c.organization.updateOperation.execute({
      actor,
      operationId: op.id,
      name: op.name,
      businessUnitId: op.businessUnitId,
      siteId: op.siteId,
      costCenter: op.costCenter,
      reason: "Synthetic edit reason",
      ...overrides,
    });

  type EditAudit = { reason: string; before: Record<string, string>; after: Record<string, string>; role: string };
  const editAudits = (operationId: string) =>
    owner<EditAudit[]>`
      select reason, before, after, role from audit_log
      where action = 'organization.operation.update' and entity_id = ${operationId} order by id`;

  it("edits an operation as parkline_app: the row changes and the audit holds the reason and both value sets", async () => {
    const o = c.organization;
    const unit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Division" }));
    const other = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Division Two" }));
    const siteA = must(await o.createSite.execute({ actor: adminActor, name: "Edit Site A" }));
    const siteB = must(await o.createSite.execute({ actor: adminActor, name: "Edit Site B" }));
    const op = must(await createOp(unit.id, siteA.id, "Edit Operation", "0801"));
    const changed = must(
      await edit(adminActor, op, { name: " edit  operación ", businessUnitId: other.id, siteId: siteB.id, costCenter: "0802", reason: "  Moved by contract  " }),
    );
    expect(changed).toMatchObject({ name: "EDIT OPERACIÓN", businessUnitId: other.id, siteId: siteB.id, costCenter: "0802" });
    const stored = await owner<{ name: string; business_unit_id: string; site_id: string; cost_center: string }[]>`
      select name, business_unit_id, site_id, cost_center from operations where id = ${op.id}`;
    expect(stored[0]).toEqual({ name: "EDIT OPERACIÓN", business_unit_id: other.id, site_id: siteB.id, cost_center: "0802" });
    const audits = await editAudits(op.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      reason: "Moved by contract",
      role: "admin",
      before: { name: "EDIT OPERATION", businessUnitId: unit.id, siteId: siteA.id, costCenter: "0801" },
      after: { name: "EDIT OPERACIÓN", businessUnitId: other.id, siteId: siteB.id, costCenter: "0802" },
    });
  });

  it("answers typed errors for a missing reason, no changes, conflicts and unknown targets without writing", async () => {
    const o = c.organization;
    const unit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Errors Division" }));
    const site = must(await o.createSite.execute({ actor: adminActor, name: "Edit Errors Site" }));
    const a = must(await createOp(unit.id, site.id, "Edit Errors A", "0811"));
    const b = must(await createOp(unit.id, site.id, "Edit Errors B", "0812"));
    const code = async (result: ReturnType<typeof edit>) => {
      const r = await result;
      return r.ok ? "ok" : r.error.code;
    };
    expect(await code(edit(adminActor, a, { name: "Other", reason: " " }))).toBe("reason_required");
    expect(await code(edit(adminActor, a))).toBe("no_changes");
    expect(await code(edit(adminActor, a, { name: "edit errors b" }))).toBe("name_taken");
    expect(await code(edit(adminActor, a, { costCenter: b.costCenter }))).toBe("cost_center_taken");
    expect(await code(edit(adminActor, a, { costCenter: "9" }))).toBe("invalid_cost_center");
    expect(await code(edit(adminActor, a, { siteId: "00000000-0000-4000-8000-000000000000" }))).toBe("not_found");
    expect(await code(edit(adminActor, a, { businessUnitId: "not-a-uuid" }))).toBe("not_found");
    expect(await editAudits(a.id)).toHaveLength(0);
  });

  it("limits a division-scoped analyst to its own division and refuses operation- and site-scoped ones", async () => {
    const o = c.organization;
    const mine = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Scoped Division" }));
    const site = must(await o.createSite.execute({ actor: adminActor, name: "Edit Scoped Site" }));
    const op = must(await createOp(mine.id, site.id, "Edit Scoped Operation", "0821"));
    const divisionActor = async (email: string, type: "business_unit" | "operation" | "site", id: string) => {
      await scopeTo(await createAnalyst(email), type, id);
      return signInActor(email);
    };
    const inScope = await divisionActor("edit.division@example.test", "business_unit", mine.id);
    expect((await edit(inScope, op, { name: "Edit Scoped Renamed", reason: "Scoped edit" })).ok).toBe(true);
    const out = await edit(inScope, op, { businessUnitId: ids.divA ?? "" });
    expect(!out.ok && out.error.code).toBe("forbidden");
    for (const [email, type, id] of [
      ["edit.operation@example.test", "operation", op.id],
      ["edit.site@example.test", "site", site.id],
    ] as const) {
      const denied = await edit(await divisionActor(email, type, id), op, { name: "Not Allowed" });
      expect(!denied.ok && denied.error.code, email).toBe("forbidden");
    }
    const audits = await editAudits(op.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.role).toBe("fleet_analyst");
  });

  it("rolls the edit back when the audit write fails", async () => {
    const o = c.organization;
    const unit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Rollback Division" }));
    const site = must(await o.createSite.execute({ actor: adminActor, name: "Edit Rollback Site" }));
    const op = must(await createOp(unit.id, site.id, "Edit Rollback Operation", "0831"));
    const failing: AuditLog = { record: () => Promise.reject(new Error("audit unavailable")) };
    const broken = createContainer(app, { hasher, wrapAudit: () => failing });
    await expect(
      broken.organization.updateOperation.execute({
        actor: adminActor,
        operationId: op.id,
        name: "Never Persisted",
        businessUnitId: unit.id,
        siteId: site.id,
        costCenter: "0832",
        reason: "Should roll back",
      }),
    ).rejects.toThrow(/audit unavailable/);
    const stored = await owner<{ name: string; cost_center: string }[]>`select name, cost_center from operations where id = ${op.id}`;
    expect(stored[0]).toEqual({ name: "EDIT ROLLBACK OPERATION", cost_center: "0831" });
  });

  it("two concurrent edits into the same name give one ok and one typed conflict, over several rounds", async () => {
    const o = c.organization;
    const unit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Race Names" }));
    const site = must(await o.createSite.execute({ actor: adminActor, name: "Edit Race Names Site" }));
    for (let round = 0; round < 8; round += 1) {
      const a = must(await createOp(unit.id, site.id, `Race Name A ${String(round)}`, `8${String(round)}01`));
      const b = must(await createOp(unit.id, site.id, `Race Name B ${String(round)}`, `8${String(round)}02`));
      const target = `Race Name Target ${String(round)}`;
      expectOneWinner(await Promise.allSettled([edit(adminActor, a, { name: target }), edit(adminActor, b, { name: target.toLowerCase() })]));
      const rows = await owner`select 1 from operations where name_key = ${target.toUpperCase()} and business_unit_id = ${unit.id}`;
      expect(rows).toHaveLength(1);
    }
  });

  it("two concurrent edits into the same cost center give one ok and one typed conflict, over several rounds", async () => {
    const o = c.organization;
    const unit = must(await o.createBusinessUnit.execute({ actor: adminActor, name: "Edit Race Codes" }));
    const site = must(await o.createSite.execute({ actor: adminActor, name: "Edit Race Codes Site" }));
    for (let round = 0; round < 8; round += 1) {
      const a = must(await createOp(unit.id, site.id, `Race Code A ${String(round)}`, `7${String(round)}01`));
      const b = must(await createOp(unit.id, site.id, `Race Code B ${String(round)}`, `7${String(round)}02`));
      const target = `7${String(round)}99`;
      expectOneWinner(
        await Promise.allSettled([edit(adminActor, a, { costCenter: target }), edit(adminActor, b, { costCenter: ` ${target} ` })]),
        "cost_center_taken",
      );
      const rows = await owner`select 1 from operations where cost_center = ${target}`;
      expect(rows).toHaveLength(1);
    }
  });
});
