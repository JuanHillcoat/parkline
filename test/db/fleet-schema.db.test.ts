import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { nameKey } from "../../src/shared/domain/catalog-name";
import { SENSITIVE_AUDIT_ACTIONS } from "../../src/shared/domain/sensitive-actions";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const APP_ROLE = "parkline_app";
const TABLES = ["suppliers", "asset_types", "equipments"] as const;
const FLEET_ACTIONS = SENSITIVE_AUDIT_ACTIONS.filter((action) => action.startsWith("fleet."));

let admin: Sql;
let sql: Sql;
const emptyAfterMigrating: Record<string, number> = {};

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  sql = postgres(url.toString(), { max: 3, onnotice: () => undefined });
  await migrate(sql, MIGRATIONS_DIR);
  // Counted before any other test inserts rows.
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

type PgError = { code?: string; message: string; constraint_name?: string };
const failure = (run: PromiseLike<unknown>): Promise<PgError | null> =>
  Promise.resolve(run).then(
    () => null,
    (error: unknown) => error as PgError,
  );

const one = async (rows: Promise<{ id: string }[]>): Promise<string> => (await rows)[0]?.id ?? "";
const addTenant = (name: string) =>
  one(sql<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), ${name}) returning id`);
const insertSupplier = (tenant: string, name: string) =>
  sql<{ id: string }[]>`insert into suppliers (tenant_id, name) values (${tenant}, ${name}) returning id`;
const addSupplier = (tenant: string, name: string) => one(insertSupplier(tenant, name));
const insertType = (tenant: string, name: string, meter = "hours", interval: number | null = 250) =>
  sql<{ id: string }[]>`
    insert into asset_types (tenant_id, name, meter_kind, preventive_interval_hours)
    values (${tenant}, ${name}, ${meter}, ${interval}) returning id`;
const addType = (tenant: string, name: string, meter = "hours", interval: number | null = 250) =>
  one(insertType(tenant, name, meter, interval));
const insertEquipment = (tenant: string, supplier: string, type: string, code: string) =>
  sql<{ id: string }[]>`
    insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code)
    values (${tenant}, ${supplier}, ${type}, ${code}) returning id`;
const addEquipment = (tenant: string, supplier: string, type: string, code: string) =>
  one(insertEquipment(tenant, supplier, type, code));
const archive = (table: (typeof TABLES)[number], id: string) =>
  sql.unsafe(`update ${table} set archived_at = now() where id = '${id}'`);
const restore = (table: (typeof TABLES)[number], id: string) =>
  sql.unsafe(`update ${table} set archived_at = null where id = '${id}'`);

/** A tenant with one supplier and one asset type, for tests that only need a valid parent pair. */
const parents = async (label: string) => {
  const tenant = await addTenant(`Tenant ${label}`);
  return { tenant, supplier: await addSupplier(tenant, `Supplier ${label}`), type: await addType(tenant, `Type ${label}`) };
};

const chars = (...codes: number[]): string => String.fromCharCode(...codes);

describe("fleet schema after migrating", () => {
  it("starts empty: no seed data in the three tables", () => {
    expect(emptyAfterMigrating).toEqual({ suppliers: 0, asset_types: 0, equipments: 0 });
  });

  it("keeps the active-row indexes and no plain unique constraint on a name or an internal code", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes where tablename in ('suppliers', 'asset_types', 'equipments')`;
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName["suppliers_active_name_key"]).toMatch(/UNIQUE.*\(tenant_id, name_key\) WHERE \(archived_at IS NULL\)/);
    expect(byName["asset_types_active_name_key"]).toMatch(/UNIQUE.*\(tenant_id, name_key\) WHERE \(archived_at IS NULL\)/);
    expect(byName["equipments_active_internal_code_key"]).toMatch(
      /UNIQUE.*\(tenant_id, supplier_id, internal_code_key\) WHERE \(archived_at IS NULL\)/,
    );
    expect(byName["equipments_active_asset_type_idx"]).toMatch(/\(tenant_id, asset_type_id\) WHERE \(archived_at IS NULL\)/);
  });
});

describe("composite foreign keys and tenant isolation", () => {
  it("rejects an equipment whose supplier or asset type belongs to another tenant or does not exist", async () => {
    const a = await parents("FK A");
    const b = await parents("FK B");
    expect((await failure(insertEquipment(a.tenant, b.supplier, a.type, "EQ-0001")))?.code).toBe("23503");
    expect((await failure(insertEquipment(a.tenant, a.supplier, b.type, "EQ-0001")))?.code).toBe("23503");
    expect((await failure(insertEquipment(a.tenant, randomUUID(), a.type, "EQ-0001")))?.code).toBe("23503");
    expect((await failure(insertEquipment(a.tenant, a.supplier, randomUUID(), "EQ-0001")))?.code).toBe("23503");
    await addEquipment(a.tenant, a.supplier, a.type, "EQ-0001");
  });

  it("rejects moving an equipment to a supplier of another tenant, and deleting a referenced parent", async () => {
    const a = await parents("FK C");
    const b = await parents("FK D");
    const equipment = await addEquipment(a.tenant, a.supplier, a.type, "EQ-0001");
    const move = sql`update equipments set supplier_id = ${b.supplier} where id = ${equipment}`;
    expect((await failure(move))?.code).toBe("23503");
    expect((await failure(sql`delete from suppliers where id = ${a.supplier}`))?.code).toBe("23503");
    expect((await failure(sql`delete from asset_types where id = ${a.type}`))?.code).toBe("23503");
  });

  it("allows the same supplier and type names in two tenants", async () => {
    const a = await parents("Shared");
    const b = await addTenant("Tenant Shared 2");
    await addSupplier(b, "Supplier Shared");
    await addType(b, "Type Shared");
    expect(a.tenant).not.toBe(b);
  });
});

describe("partial uniqueness over active rows", () => {
  it("rejects name variants of a supplier per tenant, frees the name on archive and conflicts on restore", async () => {
    const t = await addTenant("Tenant PU1");
    const first = await addSupplier(t, "SUPPLIER A");
    for (const variant of ["supplier a", "  Supplier   A ", "SUPPLIER A"]) {
      const error = await failure(insertSupplier(t, variant));
      expect([error?.code, error?.constraint_name], variant).toEqual(["23505", "suppliers_active_name_key"]);
    }
    await addSupplier(await addTenant("Tenant PU1b"), "SUPPLIER A");
    await archive("suppliers", first);
    const second = await addSupplier(t, "supplier a");
    const error = await failure(restore("suppliers", first));
    expect([error?.code, error?.constraint_name]).toEqual(["23505", "suppliers_active_name_key"]);
    await archive("suppliers", second);
    await restore("suppliers", first);
  });

  it("does the same for asset types", async () => {
    const t = await addTenant("Tenant PU2");
    const first = await addType(t, "FORKLIFT");
    const error = await failure(insertType(t, "forklift"));
    expect([error?.code, error?.constraint_name]).toEqual(["23505", "asset_types_active_name_key"]);
    await archive("asset_types", first);
    const second = await addType(t, "Forklift");
    const restored = await failure(restore("asset_types", first));
    expect([restored?.code, restored?.constraint_name]).toEqual(["23505", "asset_types_active_name_key"]);
    await archive("asset_types", second);
    await restore("asset_types", first);
  });

  it("keeps the internal code unique per supplier, allows it under two suppliers and reuses it after an archive", async () => {
    const t = await addTenant("Tenant PU3");
    const [s1, s2] = [await addSupplier(t, "SUPPLIER A"), await addSupplier(t, "SUPPLIER B")] as const;
    const type = await addType(t, "CONTAINER", "none", null);
    const first = await addEquipment(t, s1, type, "C-043");
    for (const variant of ["c-043", " C-043 "]) {
      const error = await failure(insertEquipment(t, s1, type, variant));
      expect([error?.code, error?.constraint_name], variant).toEqual(["23505", "equipments_active_internal_code_key"]);
    }
    await addEquipment(t, s2, type, "C-043");
    await archive("equipments", first);
    const second = await addEquipment(t, s1, type, "c-043");
    const error = await failure(restore("equipments", first));
    expect([error?.code, error?.constraint_name]).toEqual(["23505", "equipments_active_internal_code_key"]);
    await archive("equipments", second);
    await restore("equipments", first);
  });
});

describe("name key drift against nameKey() in TypeScript", () => {
  const awkward = [
    "  Padded  ",
    "inner   many    spaces",
    `tab${chars(9)}separated${chars(9, 9)}name`,
    `line${chars(10)}break${chars(13, 10)}name`,
    "MiXeD CaSe",
    `Camion ${chars(0xd1)}and${chars(0xfa)}`,
    // Accents on every vowel, in both cases, with every folded diacritic.
    chars(0xe1, 0xe0, 0xe2, 0xe4, 0x20, 0xe9, 0xe8, 0xea, 0xeb, 0x20, 0xed, 0xec, 0xee, 0xef, 0x20),
    chars(0xf3, 0xf2, 0xf4, 0xf6, 0x20, 0xfa, 0xf9, 0xfb, 0xfc),
    chars(0xc1, 0xc0, 0xc2, 0xc4, 0x20, 0xc9, 0xc8, 0xca, 0xcb, 0x20, 0xcd, 0xcc, 0xce, 0xcf),
    chars(0xd3, 0xd2, 0xd4, 0xd6, 0x20, 0xda, 0xd9, 0xdb, 0xdc),
    // N with tilde and C with cedilla are different letters: never folded.
    `NU${chars(0xd1)}EZ`,
    `nu${chars(0xf1)}ez`,
    "NUNEZ",
    `${chars(0xc7)}a${chars(0xe7)}a`,
    "caca",
    // Mixed whitespace: NBSP, ideographic space, BOM, line and paragraph separators, VT, FF.
    `no${chars(0xa0)}break${chars(0x2028)}line${chars(0x2029)}para${chars(0xfeff)}bom${chars(0x3000)}ideo`,
    `${chars(0x3000)}ideographic${chars(0x3000)}`,
    `vertical${chars(11)}tab${chars(12)}form feed`,
    `${chars(9, 10, 13, 12, 11, 32)}all mixed${chars(0x2003, 0x202f, 0x205f, 0x1680)}`,
    `zero${chars(0x200b)}width`,
    // Characters with no rule must not crash and must agree.
    `caf${chars(0xe9, 0x20, 0xff, 0x153)}`,
    chars(0xe3, 0xf5, 0x20, 0xe5, 0x20, 0xe6, 0x20, 0xf8),
  ];

  it("produces exactly the TypeScript key for the stored columns and the function", async () => {
    const t = await addTenant("Tenant Drift");
    const type = await addType(t, "DRIFT TYPE");
    for (const name of awkward) {
      const stored = `${randomUUID()}-${name}`;
      const supplier = await sql<{ name_key: string; fn: string }[]>`
        insert into suppliers (tenant_id, name) values (${t}, ${stored})
        returning name_key, fleet_name_key(${name}) as fn`;
      expect(supplier[0]?.fn, JSON.stringify(name)).toBe(nameKey(name));
      const code = `${String(awkward.indexOf(name))}-${name}`;
      const owner = await addSupplier(t, `S ${randomUUID()}`);
      const equipment = await sql<{ internal_code_key: string }[]>`
        insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code)
        values (${t}, ${owner}, ${type}, ${code}) returning internal_code_key`;
      expect(equipment[0]?.internal_code_key, JSON.stringify(code)).toBe(nameKey(code));
      expect(supplier[0]?.name_key, JSON.stringify(stored)).toBe(nameKey(stored));
    }
  });

  it("agrees with organization_name_key on the same inputs (same body as migration 0006)", async () => {
    for (const name of awkward) {
      const rows = await sql<{ a: string; b: string }[]>`select fleet_name_key(${name}) as a, organization_name_key(${name}) as b`;
      expect(rows[0]?.a, JSON.stringify(name)).toBe(rows[0]?.b);
    }
  });

  it("collides on the database exactly when the TypeScript keys are equal", async () => {
    const t = await addTenant("Tenant Drift Pairs");
    const pairs: [string, string][] = [
      ["A  B", "a b"],
      [`${chars(0xd1)}u`, `${chars(0xf1)}u`],
      [`z${chars(0x3000)}`, "Z"],
      [`Bah${chars(0xed)}a Blanca`, "BAHIA  BLANCA"],
      [chars(0xc1, 0xc9, 0xcd, 0xd3, 0xda), "aeiou"],
    ];
    for (const [first, second] of pairs) {
      await addSupplier(t, first);
      expect(nameKey(first)).toBe(nameKey(second));
      expect((await failure(insertSupplier(t, second)))?.code, second).toBe("23505");
    }
    await addSupplier(t, `NU${chars(0xd1)}EZ`);
    await addSupplier(t, "NUNEZ");
  });
});

describe("check constraints", () => {
  const rejected = async (run: PromiseLike<unknown>) => (await failure(run))?.code;

  it("limits the meter kind and the preventive interval", async () => {
    const t = await addTenant("Tenant CK1");
    expect(await rejected(insertType(t, "Bad meter", "miles", null))).toBe("23514");
    for (const interval of [0, -1, 10001]) expect(await rejected(insertType(t, `Interval ${String(interval)}`, "hours", interval))).toBe("23514");
    expect(await rejected(insertType(t, "None with interval", "none", 250))).toBe("23514");
    await insertType(t, "Edge low", "hours", 1);
    await insertType(t, "Edge high", "km", 10000);
    await insertType(t, "No meter", "none", null);
    await insertType(t, "No interval", "hours", null);
  });

  it("limits year and battery quantity", async () => {
    const { tenant, supplier, type } = await parents("CK2");
    const withValues = (year: number | null, battery: number | null, code: string) =>
      sql`insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code, year, battery_quantity)
          values (${tenant}, ${supplier}, ${type}, ${code}, ${year}, ${battery})`;
    for (const year of [1949, 2101]) expect(await rejected(withValues(year, null, `Y${String(year)}`))).toBe("23514");
    for (const battery of [-1, 5]) expect(await rejected(withValues(null, battery, `B${String(battery)}`))).toBe("23514");
    await withValues(1950, 0, "LOW");
    await withValues(2100, 4, "HIGH");
    await withValues(null, null, "NULLS");
  });

  it("bounds the lengths like the TypeScript rules and refuses blank names and codes", async () => {
    const { tenant, supplier, type } = await parents("CK3");
    expect(await rejected(insertSupplier(tenant, "x".repeat(121)))).toBe("23514");
    await insertSupplier(tenant, "x".repeat(120));
    expect(await rejected(insertSupplier(tenant, "   "))).toBe("23514");
    expect(await rejected(insertType(tenant, "y".repeat(121)))).toBe("23514");
    expect(await rejected(insertEquipment(tenant, supplier, type, "c".repeat(41)))).toBe("23514");
    expect(await rejected(insertEquipment(tenant, supplier, type, "  "))).toBe("23514");
    await insertEquipment(tenant, supplier, type, "c".repeat(40));
    const text = (column: string, length: number) =>
      sql.unsafe(
        `insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code, ${column})
         values ('${tenant}', '${supplier}', '${type}', '${randomUUID()}', '${"t".repeat(length)}')`,
      );
    for (const [column, max] of [["brand", 120], ["model", 120], ["serial_number", 60], ["observations", 500]] as const) {
      expect(await rejected(text(column, max + 1)), column).toBe("23514");
      await text(column, max);
    }
  });
});

describe("fleet audit actions in TypeScript", () => {
  it("lists the four fleet actions as sensitive in TypeScript", () => {
    expect(FLEET_ACTIONS).toEqual(["fleet.asset_type.update", "fleet.equipment.update", "fleet.archive", "fleet.restore"]);
  });
});

describe("audit reason trigger for the fleet actions", () => {
  const insertAudit = (handle: Sql | TransactionSql, action: string, reason: string | null) => handle`
    insert into audit_log
      (tenant_id, actor_id, actor_kind, role, action, entity_type, entity_id, origin, correlation_id, reason)
    values (gen_random_uuid(), 'actor-1', 'user', 'tester', ${action}, 'thing', 'thing-1', 'ui', 'corr-1', ${reason})`;

  it.each(FLEET_ACTIONS)("%s needs a visible reason: null, blank and invisible-only are refused", async (action) => {
    for (const reason of [null, "", "  ", chars(0x200b, 0xa0, 0xfeff), chars(0x3000, 0x2060), chars(9, 10, 0x85)]) {
      const error = await failure(insertAudit(sql, action, reason));
      expect(error?.code, JSON.stringify(reason)).toBe("23514");
      expect(error?.message).toBe(`audit action "${action}" requires a non-blank reason`);
    }
    await insertAudit(sql, action, "Motivo documentado");
  });

  it("keeps the non-sensitive fleet actions free of the rule", async () => {
    for (const action of ["fleet.supplier.create", "fleet.supplier.rename", "fleet.asset_type.create", "fleet.equipment.create"]) {
      await insertAudit(sql, action, null);
    }
  });
});

describe("restricted application role", () => {
  const privileges = async (table: string) => {
    const rows = await sql<{ p: string }[]>`
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(${APP_ROLE}, ${table}, p) order by p`;
    return rows.map((r) => r.p);
  };

  /** Runs `statement` as the application role in a transaction that is always rolled back. */
  const asApp = async (statement: (tx: TransactionSql) => PromiseLike<unknown>): Promise<PgError | null> => {
    const rollback = new Error("rollback");
    let raised: PgError | null = null;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${APP_ROLE}`);
        try {
          await tx.savepoint((sp) => statement(sp));
        } catch (error) {
          raised = error as PgError;
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return raised;
  };

  it.each(TABLES)("holds exactly SELECT, INSERT and UPDATE on %s", async (table) => {
    expect(await privileges(table)).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("selects, inserts and updates the three tables as parkline_app", async () => {
    const { tenant, supplier, type } = await parents("Grant");
    const error = await asApp(async (tx) => {
      await tx`select count(*) from suppliers`;
      const created = await tx<{ id: string }[]>`insert into suppliers (tenant_id, name) values (${tenant}, 'APP SUPPLIER') returning id`;
      await tx`update suppliers set name = 'RENAMED' where id = ${created[0]?.id ?? ""}`;
      await tx`insert into asset_types (tenant_id, name, meter_kind) values (${tenant}, 'APP TYPE', 'km')`;
      await tx`update asset_types set name = 'APP TYPE 2' where id = ${type}`;
      await tx`insert into equipments (tenant_id, supplier_id, asset_type_id, internal_code) values (${tenant}, ${supplier}, ${type}, 'APP-1')`;
      await tx`update equipments set archived_at = now() where internal_code = 'APP-1'`;
    });
    expect(error).toBeNull();
  });

  it.each(TABLES)("refuses DELETE and TRUNCATE on %s with 42501", async (table) => {
    for (const statement of [`delete from ${table}`, `truncate table ${table}`]) {
      const error = await asApp((tx) => tx.unsafe(statement));
      expect(error?.code, statement).toBe("42501");
      expect(error?.message).toMatch(new RegExp(`permission denied for table ${table}`));
    }
  });
});
