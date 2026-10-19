import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
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
let analyst: Actor;
let manager: Actor;

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
  const credentials = { email: "admin@example.test", password: PASSWORD };
  must(await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials }));
  adminActor = await signInActor(credentials.email);
  analyst = await staff("analyst@example.test", "fleet_analyst");
  manager = await staff("manager@example.test", "manager");
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

async function signInActor(email: string): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email, password: PASSWORD }));
  return toActor(must(await c.identity.authenticate.execute({ token: signed.token })));
}

async function staff(email: string, role: Role): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Staff", password: PASSWORD, role }));
  return signInActor(email);
}

const o = () => c.organization;
const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);
const names = (rows: readonly { name: string }[]): string[] => rows.map((row) => row.name);
const asAnalyst = (text: string) => ({ actor: analyst, reason: text });

let counter = 0;
/** A division, a site and an operation of their own, with a fresh cost center. */
async function fixture(label: string) {
  const costCenter = String(1000 + (counter += 1));
  const unit = must(await o().createBusinessUnit.execute({ actor: adminActor, name: `${label} Division` }));
  const site = must(await o().createSite.execute({ actor: adminActor, name: `${label} Site` }));
  const op = must(
    await o().createOperation.execute({ actor: adminActor, businessUnitId: unit.id, siteId: site.id, name: `${label} Op`, costCenter }),
  );
  return { unit, site, op, costCenter };
}

type AuditRow = { action: string; entity_type: string; reason: string; role: string; before: unknown; after: unknown };
const archivedAtOf = (entry: AuditRow | undefined): string => (entry?.after as { archivedAt: string }).archivedAt;
const audits = (entityId: string) =>
  owner<AuditRow[]>`
    select action, entity_type, reason, role, before, after from audit_log
    where entity_id = ${entityId} and action in ('organization.archive', 'organization.restore') order by id`;

describe("archiving through the container as parkline_app", () => {
  it("archives an operation: lists hide it, includeArchived shows it only to the archiver, the audit keeps the reason", async () => {
    const f = await fixture("Flow");
    const archived = must(await o().archiveOperation.execute({ ...asAnalyst("  Cargada por error  "), id: f.op.id }));
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect(names(must(await o().listOperations.execute({ actor: analyst })))).not.toContain("FLOW OP");
    expect(names(must(await o().listOperations.execute({ actor: analyst, includeArchived: true })))).toContain("FLOW OP");
    expect(names(must(await o().listOperations.execute({ actor: adminActor, includeArchived: true })))).not.toContain("FLOW OP");
    const stored = await owner<{ archived_at: Date | null }[]>`select archived_at from operations where id = ${f.op.id}`;
    expect(stored[0]?.archived_at).toBeInstanceOf(Date);
    const entries = await audits(f.op.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "organization.archive",
      entity_type: "operation",
      reason: "Cargada por error",
      role: "fleet_analyst",
      before: { archivedAt: null },
      after: { archivedAt: archived.archivedAt?.toISOString() },
    });
  });

  it("frees the name and the cost center, and a restore then fails with the typed conflict", async () => {
    const f = await fixture("Reuse");
    must(await o().archiveOperation.execute({ ...asAnalyst("Error"), id: f.op.id }));
    const create = (name: string, costCenter: string) =>
      o().createOperation.execute({ actor: adminActor, businessUnitId: f.unit.id, siteId: f.site.id, name, costCenter });
    const twin = must(await create("Reuse Op", f.costCenter));
    expect(code(await o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id }))).toBe("name_taken");
    must(await o().archiveOperation.execute({ ...asAnalyst("Cambio"), id: twin.id }));
    const sameCode = must(await create("Reuse Other", f.costCenter));
    expect(code(await o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id }))).toBe("cost_center_taken");
    must(await o().archiveOperation.execute({ ...asAnalyst("Cambio"), id: sameCode.id }));
    const restored = must(await o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id }));
    expect(restored.archivedAt).toBeNull();
    expect(names(must(await o().listOperations.execute({ actor: analyst })))).toContain("REUSE OP");
    const entries = await audits(f.op.id);
    expect(entries.map((e) => e.action)).toEqual(["organization.archive", "organization.restore"]);
    expect(entries[1]).toMatchObject({ reason: "Volver", before: { archivedAt: archivedAtOf(entries[0]) }, after: { archivedAt: null } });
  });

  it("blocks a division or a site with active operations and allows it once they are archived", async () => {
    const f = await fixture("Block");
    expect(code(await o().archiveBusinessUnit.execute({ ...asAnalyst("Baja"), id: f.unit.id }))).toBe("has_active_operations");
    expect(code(await o().archiveSite.execute({ ...asAnalyst("Baja"), id: f.site.id }))).toBe("has_active_operations");
    must(await o().archiveOperation.execute({ ...asAnalyst("Baja"), id: f.op.id }));
    must(await o().archiveSite.execute({ ...asAnalyst("Baja"), id: f.site.id }));
    must(await o().archiveBusinessUnit.execute({ ...asAnalyst("Baja"), id: f.unit.id }));
    expect(code(await o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id }))).toBe("parent_archived");
    must(await o().restoreBusinessUnit.execute({ ...asAnalyst("Volver"), id: f.unit.id }));
    must(await o().restoreSite.execute({ ...asAnalyst("Volver"), id: f.site.id }));
    must(await o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id }));
    const entity = (await audits(f.unit.id)).map((e) => `${e.action}:${e.entity_type}`);
    expect(entity).toEqual(["organization.archive:business_unit", "organization.restore:business_unit"]);
  });

  it("refuses the admin and the manager, writing nothing", async () => {
    const f = await fixture("Refused");
    for (const actor of [adminActor, manager]) {
      expect(code(await o().archiveOperation.execute({ actor, id: f.op.id, reason: "Baja" }))).toBe("forbidden");
      expect(code(await o().archiveSite.execute({ actor, id: f.site.id, reason: "Baja" }))).toBe("forbidden");
    }
    expect(await audits(f.op.id)).toHaveLength(0);
  });

  it("answers reason_required for a blank or invisible-only reason and writes nothing", async () => {
    const f = await fixture("Blank");
    for (const text of ["", "   ", String.fromCharCode(0x200b, 0x20, 0xa0)]) {
      expect(code(await o().archiveOperation.execute({ ...asAnalyst(text), id: f.op.id }))).toBe("reason_required");
    }
    expect(await audits(f.op.id)).toHaveLength(0);
  });

  it("rolls the archive back when the audit write fails", async () => {
    const f = await fixture("Rollback");
    const failing: AuditLog = { record: () => Promise.reject(new Error("audit unavailable")) };
    const broken = createContainer(app, { hasher, wrapAudit: () => failing });
    await expect(broken.organization.archiveOperation.execute({ ...asAnalyst("Baja"), id: f.op.id })).rejects.toThrow(/audit unavailable/);
    const stored = await owner<{ archived_at: Date | null }[]>`select archived_at from operations where id = ${f.op.id}`;
    expect(stored[0]?.archived_at).toBeNull();
  });
});

describe("archive races", () => {
  type Attempts = PromiseSettledResult<Result<unknown, { code: string }>>[];
  const outcomes = (attempts: Attempts): string[] =>
    attempts.map((a) => (a.status === "rejected" ? `rejected: ${JSON.stringify(a.reason)}` : code(a.value))).sort();

  it("two concurrent archives (and restores) of one row give one ok and one typed error, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const f = await fixture(`Twice ${String(round)}`);
      const input = { ...asAnalyst("Baja"), id: f.op.id };
      const archives = await Promise.allSettled([o().archiveOperation.execute(input), o().archiveOperation.execute(input)]);
      expect(outcomes(archives)).toEqual(["already_archived", "ok"]);
      const restores = await Promise.allSettled([o().restoreOperation.execute(input), o().restoreOperation.execute(input)]);
      expect(outcomes(restores)).toEqual(["not_archived", "ok"]);
      expect(await audits(f.op.id)).toHaveLength(2);
    }
  });

  it("a create that collides with a restore on the name gives one ok and one typed conflict, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const f = await fixture(`NameRace ${String(round)}`);
      must(await o().archiveOperation.execute({ ...asAnalyst("Baja"), id: f.op.id }));
      const create = o().createOperation.execute({
        actor: adminActor, businessUnitId: f.unit.id, siteId: f.site.id, name: `namerace ${String(round)} op`, costCenter: `9${String(round)}00`,
      });
      const restore = o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id });
      expect(outcomes(await Promise.allSettled([create, restore]))).toEqual(["name_taken", "ok"]);
      const rows = await owner`select 1 from operations where business_unit_id = ${f.unit.id} and archived_at is null`;
      expect(rows).toHaveLength(1);
    }
  });

  it("a create that collides with a restore on the cost center gives one ok and one typed conflict, over several rounds", async () => {
    for (let round = 0; round < 8; round += 1) {
      const f = await fixture(`CodeRace ${String(round)}`);
      must(await o().archiveOperation.execute({ ...asAnalyst("Baja"), id: f.op.id }));
      const create = o().createOperation.execute({
        actor: adminActor, businessUnitId: f.unit.id, siteId: f.site.id, name: `Other ${String(round)}`, costCenter: f.costCenter,
      });
      const restore = o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id });
      expect(outcomes(await Promise.allSettled([create, restore]))).toEqual(["cost_center_taken", "ok"]);
      const rows = await owner`select 1 from operations where cost_center = ${f.costCenter} and archived_at is null`;
      expect(rows).toHaveLength(1);
    }
  });

  it("a division or site restore that races a create of the same name gives one ok and one typed conflict", async () => {
    for (let round = 0; round < 8; round += 1) {
      const name = `Nameless ${String(round)}`;
      const unit = must(await o().createBusinessUnit.execute({ actor: adminActor, name }));
      const site = must(await o().createSite.execute({ actor: adminActor, name }));
      must(await o().archiveBusinessUnit.execute({ ...asAnalyst("Baja"), id: unit.id }));
      must(await o().archiveSite.execute({ ...asAnalyst("Baja"), id: site.id }));
      const units = await Promise.allSettled([
        o().createBusinessUnit.execute({ actor: adminActor, name }),
        o().restoreBusinessUnit.execute({ ...asAnalyst("Volver"), id: unit.id }),
      ]);
      const sites = await Promise.allSettled([
        o().createSite.execute({ actor: adminActor, name }),
        o().restoreSite.execute({ ...asAnalyst("Volver"), id: site.id }),
      ]);
      expect(outcomes(units)).toEqual(["name_taken", "ok"]);
      expect(outcomes(sites)).toEqual(["name_taken", "ok"]);
    }
  });

  // D3/D4 against a concurrent write: exactly one side wins and no active operation ends up under an archived parent.
  const oneWins = (attempts: Attempts): void => {
    expect(["has_active_operations,ok", "ok,parent_archived"]).toContain(outcomes(attempts).join(","));
  };
  const orphans = () =>
    owner`select o.id from operations o
          left join business_units u on u.id = o.business_unit_id left join sites s on s.id = o.site_id
          where o.archived_at is null and (u.archived_at is not null or s.archived_at is not null)`;
  const parents = async (label: string) => ({
    unit: must(await o().createBusinessUnit.execute({ actor: adminActor, name: `${label} Division` })),
    site: must(await o().createSite.execute({ actor: adminActor, name: `${label} Site` })),
  });

  it("a create races the archive of its division or its site: one wins and no active operation is orphaned", async () => {
    for (let round = 0; round < 6; round += 1) {
      const { unit, site } = await parents(`CreateRace ${String(round)}`);
      const create = (cc: string) =>
        o().createOperation.execute({ actor: adminActor, businessUnitId: unit.id, siteId: site.id, name: `Op ${cc}`, costCenter: cc });
      oneWins(await Promise.allSettled([create(`7${String(round)}01`), o().archiveBusinessUnit.execute({ ...asAnalyst("Baja"), id: unit.id })]));
      expect(await orphans()).toHaveLength(0);
      const other = await parents(`CreateSite ${String(round)}`);
      const into = { actor: adminActor, businessUnitId: other.unit.id, siteId: other.site.id, name: "Op", costCenter: `7${String(round)}02` };
      oneWins(await Promise.allSettled([o().createOperation.execute(into), o().archiveSite.execute({ ...asAnalyst("Baja"), id: other.site.id })]));
      expect(await orphans()).toHaveLength(0);
    }
  });

  it("an update that moves an operation races the archive of the target site: one wins and nothing is orphaned", async () => {
    for (let round = 0; round < 6; round += 1) {
      const f = await fixture(`MoveRace ${String(round)}`);
      const target = await parents(`MoveTarget ${String(round)}`);
      const move = o().updateOperation.execute({
        actor: adminActor, operationId: f.op.id, name: "Moved", businessUnitId: f.unit.id, siteId: target.site.id, costCenter: f.costCenter, reason: "Traslado",
      });
      oneWins(await Promise.allSettled([move, o().archiveSite.execute({ ...asAnalyst("Baja"), id: target.site.id })]));
      expect(await orphans()).toHaveLength(0);
    }
  });

  it("a restore races the archive of its division: one wins and nothing is orphaned", async () => {
    for (let round = 0; round < 6; round += 1) {
      const f = await fixture(`RestoreRace ${String(round)}`);
      must(await o().archiveOperation.execute({ ...asAnalyst("Baja"), id: f.op.id }));
      const restore = o().restoreOperation.execute({ ...asAnalyst("Volver"), id: f.op.id });
      oneWins(await Promise.allSettled([restore, o().archiveBusinessUnit.execute({ ...asAnalyst("Baja"), id: f.unit.id })]));
      expect(await orphans()).toHaveLength(0);
    }
  });
});
