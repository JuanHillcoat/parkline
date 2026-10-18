import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
const TABLES = ["business_units", "operations", "sites"] as const;

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
const addSite = (tenant: string, name: string) =>
  one(sql<{ id: string }[]>`insert into sites (tenant_id, name) values (${tenant}, ${name}) returning id`);
// Every call that does not care about the cost center gets a fresh four-digit code.
let nextCode = 0;
const freshCode = (): string => String((nextCode += 1)).padStart(4, "0");
const insertOperation = (tenant: string, unit: string, site: string, name: string, costCenter: string) =>
  sql<{ id: string }[]>`
    insert into operations (tenant_id, business_unit_id, site_id, name, cost_center)
    values (${tenant}, ${unit}, ${site}, ${name}, ${costCenter}) returning id`;
const addOperationAt = (tenant: string, unit: string, site: string, name: string, costCenter = freshCode()) =>
  one(insertOperation(tenant, unit, site, name, costCenter));
/** An operation at a fresh site of its own. */
const addOperation = async (tenant: string, unit: string, name: string, costCenter = freshCode()) =>
  addOperationAt(tenant, unit, await addSite(tenant, `Site of ${name} ${freshCode()}`), name, costCenter);
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
  it("applies 0005_organization.sql and the three tables start empty (no seed)", () => {
    expect(applied).toContain("0005_organization.sql");
    expect(emptyAfterMigrating).toEqual({ business_units: 0, operations: 0, sites: 0 });
  });

  it("has no operation_sites table: an operation carries exactly one site and a cost center", async () => {
    const tables = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = 'operation_sites'`;
    expect(tables).toHaveLength(0);
    const columns = await sql<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'operations' and column_name in ('site_id', 'cost_center') order by column_name`;
    expect(columns).toEqual([
      { column_name: "cost_center", is_nullable: "NO" },
      { column_name: "site_id", is_nullable: "NO" },
    ]);
  });
});

describe("composite foreign keys and tenant isolation", () => {
  it("rejects an operation whose business unit belongs to another tenant", async () => {
    const a = await addTenant("Tenant FK A");
    const b = await addTenant("Tenant FK B");
    const unitA = await addUnit(a, "Division A");
    const siteA = await addSite(a, "Site A1");
    const siteB = await addSite(b, "Site B1");
    expect((await failure(insertOperation(b, unitA, siteB, "Op", freshCode())))?.code).toBe("23503");
    expect((await failure(insertOperation(a, randomUUID(), siteA, "Op", freshCode())))?.code).toBe("23503");
    await addOperationAt(a, unitA, siteA, "Op");
  });

  it("rejects an operation whose site belongs to another tenant, does not exist or is missing", async () => {
    const a = await addTenant("Tenant ST A");
    const b = await addTenant("Tenant ST B");
    const unitA = await addUnit(a, "Division");
    const siteA = await addSite(a, "Site A1");
    const siteB = await addSite(b, "Site B1");
    // Right tenant column, foreign site: the composite key (tenant_id, site_id) does not match.
    expect((await failure(insertOperation(a, unitA, siteB, "Op", freshCode())))?.code).toBe("23503");
    expect((await failure(insertOperation(a, unitA, randomUUID(), "Op", freshCode())))?.code).toBe("23503");
    const noSite = await failure(
      sql`insert into operations (tenant_id, business_unit_id, name, cost_center)
          values (${a}, ${unitA}, 'Op', ${freshCode()})`,
    );
    expect(noSite?.code).toBe("23502");
    await addOperationAt(a, unitA, siteA, "Op");
  });

  it("allows several operations at the same site, in different divisions", async () => {
    const t = await addTenant("Tenant SH");
    const [u1, u2] = [await addUnit(t, "Division 1"), await addUnit(t, "Division 2")] as const;
    const shared = await addSite(t, "Shared Site");
    await addOperationAt(t, u1, shared, "Operation 1");
    await addOperationAt(t, u1, shared, "Operation 2");
    await addOperationAt(t, u2, shared, "Operation 3");
    const rows = await sql`select 1 from operations where tenant_id = ${t} and site_id = ${shared}`;
    expect(rows).toHaveLength(3);
  });

  it("restricts deleting a site that an operation sits at", async () => {
    const t = await addTenant("Tenant SR");
    const site = await addSite(t, "Only Site");
    await addOperationAt(t, await addUnit(t, "Division"), site, "Op");
    expect((await failure(sql`delete from sites where id = ${site}`))?.code).toBe("23503");
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

describe("cost center (D7)", () => {
  it("accepts exactly four digits and keeps leading zeros", async () => {
    const t = await addTenant("Tenant CC1");
    const unit = await addUnit(t, "Division");
    for (const code of ["0050", "0009", "1234", "0000"]) {
      await addOperation(t, unit, `Op ${code}`, code);
    }
    const rows = await sql<{ cost_center: string }[]>`
      select cost_center from operations where tenant_id = ${t} order by cost_center`;
    expect(rows.map((r) => r.cost_center)).toEqual(["0000", "0009", "0050", "1234"]);
  });

  it("rejects anything that is not exactly four ASCII digits (check constraint)", async () => {
    const t = await addTenant("Tenant CC2");
    const unit = await addUnit(t, "Division");
    const site = await addSite(t, "Site");
    for (const code of ["50", "00500", "abcd", "00 50", "", " 0050", "0050 ", "0050\n", "٠٠٠٠"]) {
      const error = await failure(insertOperation(t, unit, site, `Op ${JSON.stringify(code)}`, code));
      expect(error?.code, JSON.stringify(code)).toBe("23514");
    }
  });

  it("is unique within a tenant, across divisions and sites", async () => {
    const t = await addTenant("Tenant CC3");
    const [u1, u2] = [await addUnit(t, "Division 1"), await addUnit(t, "Division 2")] as const;
    await addOperation(t, u1, "Op One", "0050");
    expect((await failure(addOperation(t, u2, "Op Two", "0050")))?.code).toBe("23505");
    expect((await failure(addOperation(t, u1, "Op Three", "0050")))?.code).toBe("23505");
  });

  it("may be reused by another tenant", async () => {
    const [a, b] = [await addTenant("Tenant CC4"), await addTenant("Tenant CC5")] as const;
    await addOperation(a, await addUnit(a, "Division"), "Op", "0077");
    await addOperation(b, await addUnit(b, "Division"), "Op", "0077");
  });
});

describe("migration file hygiene", () => {
  it("holds only printable ASCII and line feeds: no raw control or invisible characters", () => {
    const text = readFileSync(resolve(MIGRATIONS_DIR, "0005_organization.sql"), "utf8");
    // Carriage returns are tolerated only as part of CRLF line endings.
    const stripped = text.replace(/\r\n/g, "\n");
    expect(stripped.match(/[^\x20-\x7E\n]/g) ?? []).toEqual([]);
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
    "tab\there",
    "new\nline",
    "carriage\rreturn",
    "form\ffeed",
    "vertical\vtab",
    "all\t\n\r\f\v   mixed",
    "no\u00A0break\u2028line\u2029para\uFEFFbom\u3000ideo",
  ];

  it("produces exactly the TypeScript key for awkward names (stored column and function)", async () => {
    for (const name of awkward) {
      const t = await addTenant(`Tenant Drift ${randomUUID()}`);
      const rows = await sql<{ name_key: string; fn: string }[]>`
        insert into business_units (tenant_id, name) values (${t}, ${name})
        returning name_key, organization_name_key(${name}) as fn`;
      expect(rows[0]?.name_key, JSON.stringify(name)).toBe(nameKey(name));
      expect(rows[0]?.fn, JSON.stringify(name)).toBe(nameKey(name));
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

  it("can SELECT, INSERT and UPDATE all three tables", async () => {
    const t = await addTenant("Tenant APP");
    const [unit, site] = [await addUnit(t, "Division"), await addSite(t, "Site")] as const;
    const op = await addOperationAt(t, unit, site, "Op");
    const results = await asApp([
      `insert into business_units (tenant_id, name) values ('${t}', 'App Unit')`,
      `insert into sites (tenant_id, name) values ('${t}', 'App Site')`,
      `insert into operations (tenant_id, business_unit_id, site_id, name, cost_center)
       values ('${t}', '${unit}', '${site}', 'App Op', '${freshCode()}')`,
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
