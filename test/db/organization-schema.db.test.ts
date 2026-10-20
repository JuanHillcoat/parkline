import { randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
  it("applies 0005 to 0009 (organization, names, edit, archive, fleet) and the three tables start empty (no seed)", () => {
    expect(applied).toContain("0005_organization.sql");
    expect(applied).toContain("0006_organization_names.sql");
    expect(applied).toContain("0007_organization_edit.sql");
    expect(applied).toContain("0008_organization_archive.sql");
    expect(applied.at(-1)).toBe("0009_fleet_catalogs.sql");
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

describe("archived_at and partial uniqueness (migration 0008, D5)", () => {
  type Table = (typeof TABLES)[number];
  const archive = (table: Table, id: string) => sql.unsafe(`update ${table} set archived_at = now() where id = '${id}'`);
  const restore = (table: Table, id: string) => sql.unsafe(`update ${table} set archived_at = null where id = '${id}'`);
  const constraintOf = async (run: PromiseLike<unknown>): Promise<string | undefined> =>
    ((await failure(run)) as { constraint_name?: string } | null)?.constraint_name;

  it("adds a nullable timestamptz archived_at to the three tables, null for new rows", async () => {
    const columns = await sql<{ table_name: string; data_type: string; is_nullable: string }[]>`
      select table_name, data_type, is_nullable from information_schema.columns
      where table_schema = 'public' and column_name = 'archived_at'
        and table_name in ('business_units', 'operations', 'sites') order by table_name`;
    expect(columns).toEqual(
      ["business_units", "operations", "sites"].map((table_name) => ({
        table_name,
        data_type: "timestamp with time zone",
        is_nullable: "YES",
      })),
    );
    const t = await addTenant("Tenant AR0");
    const rows = await sql`select archived_at from business_units where id = ${await addUnit(t, "Unit")}`;
    expect(rows[0]?.archived_at).toBeNull();
  });

  it("replaces the unique constraints with partial unique indexes over active rows", async () => {
    const old = await sql`
      select conname from pg_constraint where conname in (
        'business_units_tenant_id_name_key_key', 'sites_tenant_id_name_key_key',
        'operations_tenant_id_business_unit_id_name_key_key', 'operations_tenant_id_cost_center_key')`;
    expect(old).toHaveLength(0);
    const indexes = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and indexname in (
        'business_units_active_name_key', 'sites_active_name_key',
        'operations_active_name_key', 'operations_active_cost_center_key')
      order by indexname`;
    expect(indexes.map((i) => i.indexname)).toEqual([
      "business_units_active_name_key",
      "operations_active_cost_center_key",
      "operations_active_name_key",
      "sites_active_name_key",
    ]);
    for (const index of indexes) {
      expect(index.indexdef, index.indexname).toContain("CREATE UNIQUE INDEX");
      expect(index.indexdef, index.indexname).toContain("WHERE (archived_at IS NULL)");
    }
  });

  it("frees the name of an archived division and site, while two active rows still collide", async () => {
    const t = await addTenant("Tenant AR1");
    const unit = await addUnit(t, "Old Name");
    const site = await addSite(t, "Old Site");
    await archive("business_units", unit);
    await archive("sites", site);
    const reusedUnit = await addUnit(t, "old  NAME");
    const reusedSite = await addSite(t, "OLD SITE");
    expect(await constraintOf(addUnit(t, "Old Name"))).toBe("business_units_active_name_key");
    expect(await constraintOf(addSite(t, "old site"))).toBe("sites_active_name_key");
    expect(await constraintOf(restore("business_units", unit))).toBe("business_units_active_name_key");
    expect(await constraintOf(restore("sites", site))).toBe("sites_active_name_key");
    // Several archived rows may share a name, and a restore works once the name is free again.
    await archive("business_units", reusedUnit);
    await addUnit(t, "Old Name");
    await archive("sites", reusedSite);
    await restore("sites", site);
  });

  it("frees the name and the cost center of an archived operation and rejects a colliding restore by index", async () => {
    const t = await addTenant("Tenant AR2");
    const unit = await addUnit(t, "Division");
    const first = await addOperation(t, unit, "Night Ops", "0500");
    await archive("operations", first);
    const second = await addOperation(t, unit, "night ops", "0500");
    expect(await constraintOf(restore("operations", first))).toBe("operations_active_name_key");
    expect(await constraintOf(addOperation(t, unit, "NIGHT OPS", freshCode()))).toBe("operations_active_name_key");
    await sql`update operations set name = 'Day Ops' where id = ${second}`;
    expect(await constraintOf(restore("operations", first))).toBe("operations_active_cost_center_key");
    expect(await constraintOf(addOperation(t, unit, "Third", "0500"))).toBe("operations_active_cost_center_key");
    await archive("operations", second);
    await restore("operations", first);
    const rows = await sql`select 1 from operations where tenant_id = ${t} and archived_at is null`;
    expect(rows).toHaveLength(1);
  });

  it("keeps the composite foreign keys: an archived row cannot be deleted while referenced", async () => {
    const t = await addTenant("Tenant AR3");
    const unit = await addUnit(t, "Division");
    await addOperation(t, unit, "Op");
    await archive("business_units", unit);
    expect((await failure(sql`delete from business_units where id = ${unit}`))?.code).toBe("23503");
  });
});

describe("migration 0008 on a database that already has rows", () => {
  let dir = "";
  let name = "";
  let old: Sql;

  afterEach(async () => {
    await old.end();
    await admin.unsafe(`drop database if exists ${name}`);
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps every existing row active and keeps the uniqueness of active rows", async () => {
    dir = mkdtempSync(join(tmpdir(), "parkline-mig-"));
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f < "0008")) {
      copyFileSync(resolve(MIGRATIONS_DIR, file), join(dir, file));
    }
    name = `parkline_test_${randomBytes(6).toString("hex")}`;
    await admin.unsafe(`create database ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    old = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    await migrate(old, dir);
    const [t] = await old<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Legacy') returning id`;
    const tenant = t?.id ?? "";
    const [u] = await old<{ id: string }[]>`insert into business_units (tenant_id, name) values (${tenant}, 'ZONA NORTE') returning id`;
    const [s] = await old<{ id: string }[]>`insert into sites (tenant_id, name) values (${tenant}, 'PATIO') returning id`;
    await old`insert into operations (tenant_id, business_unit_id, site_id, name, cost_center)
      values (${tenant}, ${u?.id ?? ""}, ${s?.id ?? ""}, 'CAMINO', '0001')`;
    expect(await migrate(old, MIGRATIONS_DIR)).toEqual(["0008_organization_archive.sql", "0009_fleet_catalogs.sql"]);
    for (const table of TABLES) {
      const rows = await old.unsafe<{ archived_at: Date | null }[]>(`select archived_at from ${table}`);
      expect(rows.map((r) => r.archived_at), table).toEqual([null]);
    }
    const duplicate = await failure(old`insert into sites (tenant_id, name) values (${tenant}, 'patio')`);
    expect(duplicate?.code).toBe("23505");
  });
});

describe("migration file hygiene", () => {
  it.each([
    "0005_organization.sql",
    "0006_organization_names.sql",
    "0007_organization_edit.sql",
    "0008_organization_archive.sql",
    "0009_fleet_catalogs.sql",
  ])(
    "%s holds only printable ASCII and line feeds: no raw control or invisible characters",
    (file) => {
      const text = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      // Carriage returns are tolerated only as part of CRLF line endings.
      const stripped = text.replace(/\r\n/g, "\n");
      expect(stripped.match(/[^\x20-\x7E\n]/g) ?? []).toEqual([]);
    },
  );
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
    // Accents on every vowel, in both cases, with every folded diacritic.
    "\u00E1\u00E0\u00E2\u00E4 \u00E9\u00E8\u00EA\u00EB \u00ED\u00EC\u00EE\u00EF \u00F3\u00F2\u00F4\u00F6 \u00FA\u00F9\u00FB\u00FC",
    "\u00C1\u00C0\u00C2\u00C4 \u00C9\u00C8\u00CA\u00CB \u00CD\u00CC\u00CE\u00CF \u00D3\u00D2\u00D4\u00D6 \u00DA\u00D9\u00DB\u00DC",
    "Bah\u00EDa   Blanca",
    "BAHIA BLANCA",
    "bah\u00CDa\tblanca",
    // N with tilde and C with cedilla are different letters: never folded.
    "N\u00FA\u00F1ez",
    "NU\u00D1EZ",
    "NUNEZ",
    "\u00C7a\u00E7a",
    "caca",
    "\t\u00D1and\u00FA \u00C9XITO\n",
    // Characters with no rule must not crash and must agree.
    "caf\u00E9 \u00FF\u0153",
    "\u00E3\u00F5 \u00E5 \u00E6 \u00F8",
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
      ["Bahía Blanca", "BAHIA  BLANCA"],
      ["ÁÉÍÓÚ", "aeiou"],
      ["üëïöä", "UEIOA"],
    ];
    for (const [first, second] of pairs) {
      await addSite(t, first);
      expect(nameKey(first)).toBe(nameKey(second));
      expect((await failure(addSite(t, second)))?.code, second).toBe("23505");
    }
  });
});

describe("accent- and case-insensitive names (D7)", () => {
  const BAHIA = "Bahía Blanca";
  const variants = ["BAHIA BLANCA", "bahia blanca", "BAHÍA  BLANCA", " bahía\tblanca "];

  it("keeps N with tilde and C with cedilla apart from N and C", async () => {
    const t = await addTenant("Tenant NT");
    await addSite(t, "Núñez");
    await addSite(t, "Nunez");
    await addSite(t, "Çaça");
    await addSite(t, "Caca");
    expect((await failure(addSite(t, "NUÑEZ")))?.code).toBe("23505");
  });

  it("rejects accent and case variants of a division name per tenant, allows them in another tenant", async () => {
    const [a, b] = [await addTenant("Tenant AC1"), await addTenant("Tenant AC2")] as const;
    await addUnit(a, BAHIA);
    for (const name of variants) expect((await failure(addUnit(a, name)))?.code, name).toBe("23505");
    await addUnit(b, "BAHIA BLANCA");
  });

  it("rejects accent and case variants of a site name per tenant, allows them in another tenant", async () => {
    const [a, b] = [await addTenant("Tenant AC3"), await addTenant("Tenant AC4")] as const;
    await addSite(a, BAHIA);
    for (const name of variants) expect((await failure(addSite(a, name)))?.code, name).toBe("23505");
    await addSite(b, "bahia blanca");
  });

  it("rejects accent and case variants of an operation name per division, allows them in another division", async () => {
    const t = await addTenant("Tenant AC5");
    const [u1, u2] = [await addUnit(t, "Division 1"), await addUnit(t, "Division 2")] as const;
    await addOperation(t, u1, BAHIA);
    for (const name of variants) expect((await failure(addOperation(t, u1, name)))?.code, name).toBe("23505");
    await addOperation(t, u2, "BAHIA BLANCA");
  });

  it("rejects renaming into an accent variant of a sibling", async () => {
    const t = await addTenant("Tenant AC6");
    await addSite(t, BAHIA);
    const other = await addSite(t, "Other");
    expect((await failure(sql`update sites set name = 'BAHIA BLANCA' where id = ${other}`))?.code).toBe("23505");
  });
});

describe("migration 0006 on a database that already has names", () => {
  let dir = "";
  let name = "";
  let old: Sql;

  const prepare = async (): Promise<void> => {
    dir = mkdtempSync(join(tmpdir(), "parkline-mig-"));
    for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f < "0006")) {
      copyFileSync(resolve(MIGRATIONS_DIR, file), join(dir, file));
    }
    name = `parkline_test_${randomBytes(6).toString("hex")}`;
    await admin.unsafe(`create database ${name}`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    old = postgres(url.toString(), { max: 1, onnotice: () => undefined });
    await migrate(old, dir);
  };

  afterEach(async () => {
    await old.end();
    await admin.unsafe(`drop database if exists ${name}`);
    rmSync(dir, { recursive: true, force: true });
  });

  it("normalizes stored names to uppercase with collapsed whitespace and rebuilds the keys", async () => {
    await prepare();
    const [t] = await old<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Legacy') returning id`;
    const tenant = t?.id ?? "";
    const [u] = await old<{ id: string }[]>`insert into business_units (tenant_id, name) values (${tenant}, '  Zona   Norte ') returning id`;
    const [s] = await old<{ id: string }[]>`insert into sites (tenant_id, name) values (${tenant}, ${"bahía  blanca"}) returning id`;
    await old`insert into operations (tenant_id, business_unit_id, site_id, name, cost_center)
      values (${tenant}, ${u?.id ?? ""}, ${s?.id ?? ""}, ${"Camino\tviejo"}, '0001')`;
    await migrate(old, MIGRATIONS_DIR);
    const rows = await old<{ n: string; k: string }[]>`
      select name as n, name_key as k from business_units
      union all select name, name_key from sites
      union all select name, name_key from operations order by 1`;
    expect(rows).toEqual([
      { n: "BAHÍA BLANCA", k: "BAHIA BLANCA" },
      { n: "CAMINO VIEJO", k: "CAMINO VIEJO" },
      { n: "ZONA NORTE", k: "ZONA NORTE" },
    ]);
  });

  it("fails, rolling back, when normalization would create duplicate names", async () => {
    await prepare();
    const [t] = await old<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Legacy') returning id`;
    const tenant = t?.id ?? "";
    await old`insert into sites (tenant_id, name) values (${tenant}, ${"Bahía"}), (${tenant}, ${"BAHIA"})`;
    await expect(migrate(old, MIGRATIONS_DIR)).rejects.toThrow();
    const applied = await old`select 1 from schema_migrations where name like '0006%'`;
    expect(applied).toHaveLength(0);
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
      `update business_units set archived_at = now() where id = '${unit}'`,
      `update operations set archived_at = now() where id = '${op}'`,
      `update sites set archived_at = now() where id = '${site}'`,
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
