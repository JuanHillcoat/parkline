import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { nameKey } from "../../src/organization/domain/name";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const APP_ROLE = "parkline_app";
const TABLES = ["business_units", "operations", "sites", "operation_sites"] as const;

let admin: Sql;
let sql: Sql;
let applied: string[];

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  sql = postgres(url.toString(), { max: 3, onnotice: () => undefined });
  // Counted before any other test inserts rows.
  applied = await migrate(sql, MIGRATIONS_DIR);
  for (const table of TABLES) {
    const rows = await sql.unsafe(`select count(*)::int as n from ${table}`);
    emptyAfterMigrating[table] = Number(rows[0]?.n);
  }
});

afterAll(async () => {
  await sql.end();
  await admin.unsafe(`drop database if exists ${dbName}`);
  await admin.end();
});

const emptyAfterMigrating: Record<string, number> = {};

const one = async (rows: Promise<{ id: string }[]>): Promise<string> => (await rows)[0]?.id ?? "";
const addTenant = (name: string) =>
  one(sql<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), ${name}) returning id`);
const addUnit = (tenant: string, name: string) =>
  one(sql<{ id: string }[]>`insert into business_units (tenant_id, name) values (${tenant}, ${name}) returning id`);
const addOperation = (tenant: string, unit: string, name: string) =>
  one(
    sql<{ id: string }[]>`insert into operations (tenant_id, business_unit_id, name) values (${tenant}, ${unit}, ${name}) returning id`,
  );
const addSite = (tenant: string, name: string) =>
  one(sql<{ id: string }[]>`insert into sites (tenant_id, name) values (${tenant}, ${name}) returning id`);
const addLink = (tenant: string, operation: string, site: string) =>
  sql`insert into operation_sites (tenant_id, operation_id, site_id) values (${tenant}, ${operation}, ${site})`;
const addUser = (tenant: string, email: string) =>
  one(
    sql<{ id: string }[]>`insert into users (id, tenant_id, email, display_name, password_hash)
      values (gen_random_uuid(), ${tenant}, ${email}, 'Synthetic User', 'scrypt$hash') returning id`,
  );

type PgError = { code?: string; message: string };
const failure = (run: PromiseLike<unknown>): Promise<PgError | null> =>
  Promise.resolve(run).then(
    () => null,
    (error: unknown) => error as PgError,
  );

describe("organization schema after migrating", () => {
  it("applies 0005_organization.sql and the four tables start empty (no seed)", () => {
    expect(applied).toContain("0005_organization.sql");
    expect(emptyAfterMigrating).toEqual({ business_units: 0, operations: 0, sites: 0, operation_sites: 0 });
  });
});

describe("composite foreign keys and tenant isolation", () => {
  it("rejects an operation whose business unit belongs to another tenant", async () => {
    const a = await addTenant("Tenant FK A");
    const b = await addTenant("Tenant FK B");
    const unitA = await addUnit(a, "Division A");
    expect((await failure(addOperation(b, unitA, "Op")))?.code).toBe("23503");
    expect((await failure(addOperation(a, randomUUID(), "Op")))?.code).toBe("23503");
    await addOperation(a, unitA, "Op");
  });

  it("rejects a link whose operation or site belongs to another tenant or does not exist", async () => {
    const a = await addTenant("Tenant LK A");
    const b = await addTenant("Tenant LK B");
    const opA = await addOperation(a, await addUnit(a, "Division"), "Op A");
    const siteA = await addSite(a, "Site A");
    const siteB = await addSite(b, "Site B");
    expect((await failure(addLink(a, opA, siteB)))?.code).toBe("23503");
    expect((await failure(addLink(b, opA, siteB)))?.code).toBe("23503");
    expect((await failure(addLink(a, randomUUID(), siteA)))?.code).toBe("23503");
    await addLink(a, opA, siteA);
  });

  it("rejects a duplicate link and allows many-to-many", async () => {
    const t = await addTenant("Tenant NM");
    const unit = await addUnit(t, "Division");
    const [op1, op2] = [await addOperation(t, unit, "Op 1"), await addOperation(t, unit, "Op 2")] as const;
    const [s1, s2] = [await addSite(t, "Site 1"), await addSite(t, "Site 2")] as const;
    for (const [op, site] of [[op1, s1], [op1, s2], [op2, s1]] as const) await addLink(t, op, site);
    expect((await failure(addLink(t, op1, s1)))?.code).toBe("23505");
  });

  it("restricts deleting a row that something references", async () => {
    const t = await addTenant("Tenant RS");
    const unit = await addUnit(t, "Division");
    await addOperation(t, unit, "Op");
    expect((await failure(sql`delete from business_units where id = ${unit}`))?.code).toBe("23503");
  });
});

describe("name uniqueness (D7)", () => {
  it("rejects business unit and site names that differ only in case or spacing", async () => {
    const t = await addTenant("Tenant UQ");
    await addUnit(t, "Fleet North");
    await addSite(t, "Main Yard");
    for (const name of ["fleet north", "  FLEET   NORTH ", "Fleet\tNorth"]) {
      expect((await failure(addUnit(t, name)))?.code, name).toBe("23505");
    }
    for (const name of ["main yard", " MAIN  YARD"]) {
      expect((await failure(addSite(t, name)))?.code, name).toBe("23505");
    }
  });

  it("allows the same name in another tenant", async () => {
    const [a, b] = [await addTenant("Tenant OW A"), await addTenant("Tenant OW B")] as const;
    await addUnit(a, "Shared Name");
    await addUnit(b, "Shared name");
    await addSite(a, "Shared Site");
    await addSite(b, "shared site");
  });

  it("makes an operation name unique per business unit, not per tenant", async () => {
    const t = await addTenant("Tenant OP");
    const [u1, u2] = [await addUnit(t, "Division 1"), await addUnit(t, "Division 2")] as const;
    await addOperation(t, u1, "Night Shift Ops");
    await addOperation(t, u2, "night  shift ops");
    expect((await failure(addOperation(t, u1, " NIGHT SHIFT OPS ")))?.code).toBe("23505");
  });

  it("rejects a blank name and a rename into an existing name", async () => {
    const t = await addTenant("Tenant BL");
    expect((await failure(addUnit(t, "   ")))?.code).toBe("23514");
    const first = await addSite(t, "First");
    await addSite(t, "Second");
    expect((await failure(sql`update sites set name = ' SECOND ' where id = ${first}`))?.code).toBe("23505");
    await sql`update sites set name = 'FIRST' where id = ${first}`;
  });
});

describe("name key drift against nameKey() in TypeScript", () => {
  const awkward = [
    "  Padded  ",
    "inner   many    spaces",
    "tab\tseparated\t\tname",
    "line\nbreak\r\nname",
    "MiXeD CaSe",
    "Camión Ñandú",
    "ÁÉÍÓÚ Üñ",
    "nbsp between",
    "　ideographic　space　",
    "﻿bom prefix",
    "em space thin",
    "  x   ",
    "zero​width",
    "next\u0085line",
    "mongolian᠎vowel",
    "vertical\u000Btab\u000Cform feed",
    "naïve café résumé",
    "  \t MIXED   \t Everything\n ",
  ];

  it("produces exactly the TypeScript key for awkward names (stored column and function)", async () => {
    for (const name of awkward) {
      const t = await addTenant(`Tenant Drift ${randomUUID()}`);
      const rows = await sql<{ name_key: string; fn: string }[]>`
        insert into business_units (tenant_id, name) values (${t}, ${name})
        returning name_key, organization_name_key(${name}) as fn`;
      expect(rows[0]?.name_key, JSON.stringify(name)).toBe(nameKey(name));      expect(rows[0]?.fn, JSON.stringify(name)).toBe(nameKey(name));
    }
  });

  it("collides on the database exactly when the TypeScript keys are equal", async () => {
    const t = await addTenant("Tenant Drift Pairs");
    const pairs: [string, string][] = [
      ["A  B", "a b"],
      ["Ñu", "ñu"],
      ["x y", "x y"],
      ["z　", "Z"],
    ];
    for (const [first, second] of pairs) {
      await addSite(t, first);
      expect(nameKey(first)).toBe(nameKey(second));
      expect((await failure(addSite(t, second)))?.code, second).toBe("23505");
    }
  });
});

describe("role assignment scope integrity (D3)", () => {
  const assign = (
    tenant: string,
    user: string,
    scope: { type: string; id: string },
    typed: { bu?: string; op?: string; site?: string },
  ) => sql`
    insert into user_role_assignments
      (id, tenant_id, user_id, role, scope_type, scope_id,
       scope_business_unit_id, scope_operation_id, scope_site_id)
    values (gen_random_uuid(), ${tenant}, ${user}, 'viewer', ${scope.type}, ${scope.id},
       ${typed.bu ?? null}, ${typed.op ?? null}, ${typed.site ?? null})`;

  it("accepts a business unit, operation and site scope that exist in the same tenant", async () => {
    const t = await addTenant("Tenant SC");
    const u = await addUser(t, "scope@example.test");
    const unit = await addUnit(t, "Division");
    const op = await addOperation(t, unit, "Op");
    const site = await addSite(t, "Site");
    await assign(t, u, { type: "business_unit", id: unit }, { bu: unit });
    await assign(t, u, { type: "operation", id: op }, { op });
    await assign(t, u, { type: "site", id: site }, { site });
  });

  it("rejects a scope that points at a missing row or at another tenant", async () => {
    const t = await addTenant("Tenant SC2");
    const other = await addTenant("Tenant SC3");
    const u = await addUser(t, "scope2@example.test");
    const foreignUnit = await addUnit(other, "Foreign Division");
    const foreignOp = await addOperation(other, foreignUnit, "Foreign Op");
    const foreignSite = await addSite(other, "Foreign Site");
    const missing = randomUUID();
    const cases: [string, string, Parameters<typeof assign>[3]][] = [
      ["business_unit", missing, { bu: missing }],
      ["operation", missing, { op: missing }],
      ["site", missing, { site: missing }],
      ["business_unit", foreignUnit, { bu: foreignUnit }],
      ["operation", foreignOp, { op: foreignOp }],
      ["site", foreignSite, { site: foreignSite }],
    ];
    for (const [type, id, typed] of cases) {
      expect((await failure(assign(t, u, { type, id }, typed)))?.code, `${type} ${id}`).toBe("23503");
    }
  });

  it("rejects a tenant scope with a typed column, a mismatched column and a mismatched text id", async () => {
    const t = await addTenant("Tenant SC4");
    const u = await addUser(t, "scope3@example.test");
    const unit = await addUnit(t, "Division");
    const op = await addOperation(t, unit, "Op");
    const site = await addSite(t, "Site");
    expect((await failure(assign(t, u, { type: "tenant", id: t }, { bu: unit })))?.code).toBe("23514");
    expect((await failure(assign(t, u, { type: "business_unit", id: unit }, { op })))?.code).toBe("23514");
    expect((await failure(assign(t, u, { type: "site", id: site }, {})))?.code).toBe("23514");
    expect((await failure(assign(t, u, { type: "business_unit", id: unit }, { bu: unit, site })))?.code).toBe("23514");
    expect((await failure(assign(t, u, { type: "site", id: op }, { site })))?.code).toBe("23514");
    await assign(t, u, { type: "tenant", id: t }, {});
  });
});

describe("restricted application role on the organization tables", () => {
  const asApp = async (statements: string[]): Promise<(PgError | null)[]> => {
    const rollback = new Error("rollback");
    const raised: (PgError | null)[] = [];
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${APP_ROLE}`);
        for (const statement of statements) {
          raised.push(await tx.savepoint((sp) => sp.unsafe(statement)).then(() => null, (e: unknown) => e as PgError));
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return raised;
  };

  it("can SELECT, INSERT and UPDATE all four tables", async () => {
    const t = await addTenant("Tenant APP");
    const [unit, site] = [await addUnit(t, "Division"), await addSite(t, "Site")] as const;
    const op = await addOperation(t, unit, "Op");
    const results = await asApp([
      `insert into business_units (tenant_id, name) values ('${t}', 'App Unit')`,
      `insert into sites (tenant_id, name) values ('${t}', 'App Site')`,
      `insert into operations (tenant_id, business_unit_id, name) values ('${t}', '${unit}', 'App Op')`,
      `insert into operation_sites (tenant_id, operation_id, site_id) values ('${t}', '${op}', '${site}')`,
      `update business_units set name = 'Renamed' where id = '${unit}'`,
      `update operations set name = 'Renamed' where id = '${op}'`,
      `update sites set name = 'Renamed' where id = '${site}'`,
      ...TABLES.map((table) => `select count(*) from ${table}`),
    ]);
    expect(results).toEqual(results.map(() => null));
  });

  it("cannot DELETE or TRUNCATE any of them (42501)", async () => {
    const statements = TABLES.flatMap((table) => [`delete from ${table}`, `truncate ${table}`]);
    const results = await asApp(statements);
    results.forEach((error, index) => {
      expect(error?.code, statements[index]).toBe("42501");
    });
  });

  it("holds exactly SELECT, INSERT and UPDATE, and nothing is granted to PUBLIC", async () => {
    for (const table of TABLES) {
      const held = await sql<{ p: string }[]>`
        select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
        where has_table_privilege(${APP_ROLE}, ${table}, p) order by p`;
      expect(held.map((r) => r.p), table).toEqual(["INSERT", "SELECT", "UPDATE"]);
      const grants = await sql<{ grantee: string }[]>`
        select grantee from information_schema.role_table_grants where table_name = ${table} and grantee = 'PUBLIC'`;
      expect(grants, table).toHaveLength(0);
    }
  });
});
