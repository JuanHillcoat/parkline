import { PostgresEquipmentImageRepository } from "../../src/fleet/infrastructure/postgres-equipment-image-repository";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres, { type Sql, type TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/migrate";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { Role } from "../../src/identity/domain/role";
import { ScryptPasswordHasher } from "../../src/identity/infrastructure/scrypt-password-hasher";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import { imageHash, MAX_IMAGE_BYTES } from "../../src/shared/domain/image";
import type { Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_URL = "postgres://parkline:parkline_dev@localhost:54329/parkline";
const adminUrl = new URL(process.env.DATABASE_URL ?? DEFAULT_URL);
const dbName = `parkline_test_${randomBytes(6).toString("hex")}`;
const PASSWORD = "correct-horse-battery";
const hasher = new ScryptPasswordHasher({ N: 16, r: 1, p: 1 });
const APP_ROLE = "parkline_app";

let admin: Sql;
let owner: Sql;
let app: Sql;
let url: URL;
let c: Container;
let adminActor: Actor;

beforeAll(async () => {
  admin = postgres(adminUrl.toString(), { max: 2, onnotice: () => undefined });
  await admin.unsafe(`create database ${dbName}`);
  url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  owner = postgres(url.toString(), { max: 4, onnotice: () => undefined });
  await migrate(owner, MIGRATIONS_DIR);
  app = postgres(url.toString(), { max: 8, onnotice: () => undefined, connection: { role: APP_ROLE } });
  c = createContainer(app, { hasher });
  const credentials = { email: "admin@example.test", password: PASSWORD };
  must(await c.identity.install.execute({ tenantName: "Synthetic Tenant", displayName: "Admin", ...credentials }));
  adminActor = await signInActor(credentials.email);
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

/** A user with one role over one scope, signed in. */
async function scopedStaff(email: string, role: Role, scope: { type: string; id: string }): Promise<Actor> {
  const signed = must(await c.identity.signIn.execute({ email: "admin@example.test", password: PASSWORD }));
  const context = must(await c.identity.authenticate.execute({ token: signed.token }));
  must(await c.identity.createUser.execute({ actor: context, email, displayName: "Synthetic Scoped", password: PASSWORD, role, scope }));
  return signInActor(email);
}

type PgError = { code?: string; message: string; constraint_name?: string };
const failure = (run: PromiseLike<unknown>): Promise<PgError | null> =>
  Promise.resolve(run).then(
    () => null,
    (error: unknown) => error as PgError,
  );
const code = (result: Result<unknown, { code: string }>): string => (result.ok ? "ok" : result.error.code);

/** Magic bytes, then a marker byte repeated up to `size`, so images differ by hash. */
const image = (magic: readonly number[], marker: number, size = 64): Uint8Array => {
  const bytes = new Uint8Array(size).fill(marker);
  bytes.set(magic);
  return bytes;
};
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpegA = image(JPEG, 1);
const jpegB = image(JPEG, 2);
const png = image(PNG, 3);

let counter = 0;
const next = (): string => String((counter += 1));

/** A supplier and an asset type of their own; returns the ids and a function that edits an equipment of them. */
async function parents(label: string) {
  const n = next();
  const supplier = must(await c.fleet.createSupplier.execute({ actor: adminActor, name: `${label} Supplier ${n}` }));
  const type = must(
    await c.fleet.createAssetType.execute({ actor: adminActor, name: `${label} Type ${n}`, meterKind: "hours", preventiveIntervalHours: 250 }),
  );
  return { supplierId: supplier.id, assetTypeId: type.id, n };
}

async function createEquipment(label: string, imageBytes: Uint8Array | null = null) {
  const p = await parents(label);
  const equipment = must(
    await c.fleet.createEquipment.execute({
      actor: adminActor, supplierId: p.supplierId, assetTypeId: p.assetTypeId, internalCode: `EQ-${p.n}`,
      brand: "Brand", model: "Model", year: null, serialNumber: null, batteryKind: "combustion", batteryQuantity: null, observations: null, image: imageBytes,
    }),
  );
  return { equipment, ...p };
}

type Created = Awaited<ReturnType<typeof createEquipment>>;
const editInput = (e: Created, extra: object) => ({
  actor: adminActor, id: e.equipment.id, reason: "Photo change", supplierId: e.supplierId, assetTypeId: e.assetTypeId,
  internalCode: e.equipment.internalCode, brand: "Brand", model: "Model", year: null, serialNumber: null,
  batteryKind: "combustion", batteryQuantity: null, observations: null, ...extra,
});

type ImageRow = { content_type: string; byte_size: number; sha256: string; n: number };
const rowsOf = (equipmentId: string) =>
  owner<ImageRow[]>`
    select content_type, byte_size, sha256, count(*) over ()::int as n from equipment_images where equipment_id = ${equipmentId}`;

type AuditRow = { action: string; before: { imageHash?: string | null } | null; after: { imageHash?: string | null } | null; reason: string | null };
const auditOf = (equipmentId: string, action: string) =>
  owner<AuditRow[]>`select action, before, after, reason from audit_log where entity_id = ${equipmentId} and action = ${action} order by id`;

/** A raw insert as the owner, valid unless a field is overridden. */
const insertImage = (handle: Sql | TransactionSql, equipmentId: string, over: Partial<{ type: string; size: number; sha: string; data: Uint8Array; tenant: string }> = {}) => {
  const data = over.data ?? jpegA;
  return handle`
    insert into equipment_images (tenant_id, equipment_id, content_type, byte_size, sha256, data)
    values (${over.tenant ?? adminActor.tenantId}, ${equipmentId}, ${over.type ?? "image/jpeg"}, ${over.size ?? data.length},
            ${over.sha ?? imageHash(data)}, ${Buffer.from(data)})`;
};

describe("equipment_images schema", () => {
  it("has the expected columns and key", async () => {
    const cols = await owner<{ column_name: string; is_nullable: string }[]>`
      select column_name, is_nullable from information_schema.columns where table_name = 'equipment_images' order by ordinal_position`;
    expect(cols.map((col) => col.column_name)).toEqual([
      "tenant_id", "equipment_id", "content_type", "byte_size", "sha256", "data", "updated_at",
    ]);
    expect(cols.every((col) => col.is_nullable === "NO")).toBe(true);
    const key = await owner<{ attname: string }[]>`
      select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'equipment_images'::regclass and i.indisprimary order by a.attname`;
    expect(key.map((row) => row.attname)).toEqual(["equipment_id", "tenant_id"]);
  });

  it("accepts a valid row of each type and allows exactly one per equipment", async () => {
    const e = await createEquipment("Valid");
    const cases: [string, Uint8Array][] = [["image/jpeg", jpegA], ["image/png", png], ["image/webp", image([0x52, 0x49, 0x46, 0x46], 5)]];
    for (const [type, data] of cases) {
      const other = await createEquipment(`Valid ${type}`);
      expect(await failure(insertImage(owner, other.equipment.id, { type, data }))).toBeNull();
    }
    expect(await failure(insertImage(owner, e.equipment.id))).toBeNull();
    expect((await failure(insertImage(owner, e.equipment.id)))?.code).toBe("23505");
  });

  it("rejects each check: type, size bounds, size mismatch, hash format and hash mismatch", async () => {
    const e = await createEquipment("Checks");
    const id = e.equipment.id;
    const big = image(JPEG, 1, MAX_IMAGE_BYTES + 1);
    const rejected: [string, Parameters<typeof insertImage>[2]][] = [
      ["type gif", { type: "image/gif" }],
      ["type svg", { type: "image/svg+xml" }],
      ["empty", { data: new Uint8Array(0), sha: imageHash(new Uint8Array(0)) }],
      ["too large", { data: big }],
      ["size zero", { size: 0 }],
      ["size mismatch", { size: jpegA.length + 1 }],
      ["hash uppercase", { sha: imageHash(jpegA).toUpperCase() }],
      ["hash short", { sha: "abc" }],
      ["hash not of the data", { sha: imageHash(png) }],
    ];
    for (const [label, over] of rejected) expect((await failure(insertImage(owner, id, over)))?.code, label).toBe("23514");
    expect(await failure(insertImage(owner, id, { data: image(JPEG, 1, MAX_IMAGE_BYTES) }))).toBeNull();
  });

  it("is tied to its equipment by a composite foreign key: no orphan, no other tenant, no delete of the equipment", async () => {
    const e = await createEquipment("Key");
    expect((await failure(insertImage(owner, randomUUID())))?.code).toBe("23503");
    const [other] = await owner<{ id: string }[]>`insert into tenants (id, name) values (gen_random_uuid(), 'Other Tenant') returning id`;
    expect((await failure(insertImage(owner, e.equipment.id, { tenant: other?.id ?? "" })))?.code).toBe("23503");
    await insertImage(owner, e.equipment.id);
    const deleted = await failure(owner`delete from equipments where id = ${e.equipment.id}`);
    expect(deleted?.code).toBe("23503");
  });

  it("holds only printable ASCII and line feeds (migration file hygiene)", () => {
    const text = readFileSync(resolve(MIGRATIONS_DIR, "0011_equipment_images.sql"), "utf8");
    expect(text.replace(/\r\n/g, "\n").match(/[^\x20-\x7E\n]/g) ?? []).toEqual([]);
  });
});

describe("PostgresEquipmentImageRepository.remove", () => {
  it("does nothing, and does not fail, for an equipment that has no image", async () => {
    const e = await createEquipment("NoImage");
    await app.begin(async (tx) => {
      await new PostgresEquipmentImageRepository(tx).remove(e.equipment.tenantId, e.equipment.id);
    });
    expect(await rowsOf(e.equipment.id)).toHaveLength(0);
  });
});

describe("equipment_images as parkline_app", () => {
  it("holds SELECT, INSERT, UPDATE and DELETE, and neither TRUNCATE nor REFERENCES nor TRIGGER", async () => {
    const rows = await owner<{ p: string }[]>`
      select p from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
      where has_table_privilege(${APP_ROLE}, 'equipment_images', p) order by p`;
    expect(rows.map((r) => r.p)).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("selects, inserts, updates and deletes through its own connection; TRUNCATE is refused", async () => {
    const e = await createEquipment("Grant");
    await insertImage(app, e.equipment.id);
    await app`update equipment_images set updated_at = now() where equipment_id = ${e.equipment.id}`;
    expect(await app`select equipment_id from equipment_images where equipment_id = ${e.equipment.id}`).toHaveLength(1);
    await app`delete from equipment_images where equipment_id = ${e.equipment.id}`;
    expect(await rowsOf(e.equipment.id)).toHaveLength(0);
    const truncate = await failure(app.unsafe("truncate table equipment_images"));
    expect(truncate?.code).toBe("42501");
  });

  it("does not change the audit trigger: the image change is not a sensitive action of its own", async () => {
    const fn = await owner<{ src: string }[]>`select pg_get_functiondef('audit_log_require_reason'::regproc) as src`;
    expect(fn[0]?.src).not.toMatch(/image/);
  });
});

describe("image flows through the container as parkline_app", () => {
  it("creates with an image, reads it back, lists only its hash and audits the hash", async () => {
    const e = await createEquipment("Create", jpegA);
    const got = must(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: e.equipment.id }));
    expect(got).toMatchObject({ contentType: "image/jpeg", byteSize: jpegA.length, sha256: imageHash(jpegA) });
    expect([...got.data]).toEqual([...jpegA]);
    const [row] = await rowsOf(e.equipment.id);
    expect(row).toMatchObject({ content_type: "image/jpeg", byte_size: jpegA.length, sha256: imageHash(jpegA) });
    const listed = must(await c.fleet.listEquipment.execute({ actor: adminActor })).find((item) => item.id === e.equipment.id);
    expect(listed?.imageHash).toBe(imageHash(jpegA));
    expect(must(await c.fleet.getEquipment.execute({ actor: adminActor, id: e.equipment.id })).imageHash).toBe(imageHash(jpegA));
    expect((await auditOf(e.equipment.id, "fleet.equipment.create"))[0]?.after).toMatchObject({ imageHash: imageHash(jpegA) });
  });

  it("creates without an image: no row, a null hash in the list and in the audit entry, not_found for the image", async () => {
    const e = await createEquipment("Bare");
    expect(await rowsOf(e.equipment.id)).toHaveLength(0);
    expect(code(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: e.equipment.id }))).toBe("not_found");
    const listed = must(await c.fleet.listEquipment.execute({ actor: adminActor })).find((item) => item.id === e.equipment.id);
    expect(listed?.imageHash).toBeNull();
    expect((await auditOf(e.equipment.id, "fleet.equipment.create"))[0]?.after).toMatchObject({ imageHash: null });
  });

  it("refuses an invalid image before writing anything", async () => {
    const p = await parents("Invalid");
    const create = (bytes: Uint8Array) =>
      c.fleet.createEquipment.execute({
        actor: adminActor, supplierId: p.supplierId, assetTypeId: p.assetTypeId, internalCode: `EQ-${p.n}`,
        brand: "Brand", model: "Model", year: null, serialNumber: null, batteryKind: "combustion", batteryQuantity: null, observations: null, image: bytes,
      });
    const svg = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    expect(code(await create(svg))).toBe("image_unsupported_type");
    expect(code(await create(new Uint8Array(0)))).toBe("image_empty");
    expect(code(await create(image(JPEG, 1, MAX_IMAGE_BYTES + 1)))).toBe("image_too_large");
    const found = await owner`select 1 from equipments where internal_code = ${`EQ-${p.n}`}`;
    expect(found).toHaveLength(0);
    expect(code(await create(image(JPEG, 1, MAX_IMAGE_BYTES)))).toBe("ok");
  });

  it("replaces and removes, with the hash before and after in the audit entries", async () => {
    const e = await createEquipment("Replace", jpegA);
    must(await c.fleet.updateEquipment.execute(editInput(e, { image: { action: "replace", bytes: png } })));
    expect(await rowsOf(e.equipment.id)).toMatchObject([{ content_type: "image/png", sha256: imageHash(png), n: 1 }]);
    must(await c.fleet.updateEquipment.execute(editInput(e, { image: { action: "remove" } })));
    expect(await rowsOf(e.equipment.id)).toHaveLength(0);
    const entries = await auditOf(e.equipment.id, "fleet.equipment.update");
    expect(entries.map((entry) => [entry.before?.imageHash, entry.after?.imageHash])).toEqual([
      [imageHash(jpegA), imageHash(png)],
      [imageHash(png), null],
    ]);
    expect(entries.map((entry) => entry.reason)).toEqual(["Photo change", "Photo change"]);
  });

  it("treats an image-only change as a change and a no-op as no_changes; a refused edit keeps the old image", async () => {
    const e = await createEquipment("Only", jpegA);
    expect(code(await c.fleet.updateEquipment.execute(editInput(e, {})))).toBe("no_changes");
    expect(code(await c.fleet.updateEquipment.execute(editInput(e, { image: { action: "replace", bytes: jpegA } })))).toBe("no_changes");
    expect(code(await c.fleet.updateEquipment.execute(editInput(e, { image: { action: "replace", bytes: new Uint8Array(3) }, model: "Other" })))).toBe("image_unsupported_type");
    expect(code(await c.fleet.updateEquipment.execute(editInput(e, { image: { action: "replace", bytes: jpegB } })))).toBe("ok");
    expect((await rowsOf(e.equipment.id))[0]?.sha256).toBe(imageHash(jpegB));
    const bare = await createEquipment("OnlyBare");
    expect(code(await c.fleet.updateEquipment.execute(editInput(bare, { image: { action: "remove" } })))).toBe("no_changes");
  });

  it("keeps the image through an archive and a restore", async () => {
    const e = await createEquipment("Archive", jpegA);
    const analyst = await scopedStaff(`archive-${e.n}@example.test`, "fleet_analyst", { type: "tenant", id: adminActor.tenantId });
    must(await c.fleet.archiveEquipment.execute({ actor: analyst, id: e.equipment.id, reason: "Retired" }));
    expect((await rowsOf(e.equipment.id))[0]?.sha256).toBe(imageHash(jpegA));
    must(await c.fleet.restoreEquipment.execute({ actor: analyst, id: e.equipment.id, reason: "Back" }));
    expect(code(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: e.equipment.id }))).toBe("ok");
  });

  it("serves the image to a reader whose scope covers the open assignment and hides it from the others", async () => {
    const e = await createEquipment("Scope", jpegA);
    const n = e.n;
    const division = must(await c.organization.createBusinessUnit.execute({ actor: adminActor, name: `Img Division ${n}` }));
    const site = must(await c.organization.createSite.execute({ actor: adminActor, name: `Img Site ${n}` }));
    const op = (name: string, costCenter: string) =>
      c.organization.createOperation.execute({ actor: adminActor, businessUnitId: division.id, siteId: site.id, name, costCenter });
    const here = must(await op(`Img Op A ${n}`, String(2000 + Number(n)).padStart(4, "0")));
    const there = must(await op(`Img Op B ${n}`, String(3000 + Number(n)).padStart(4, "0")));
    must(await c.fleet.assignEquipment.execute({ actor: adminActor, equipmentId: e.equipment.id, target: { operationId: here.id }, day: new Date().toISOString().slice(0, 10), reason: null }));
    const inScope = await scopedStaff(`in-${n}@example.test`, "viewer", { type: "operation", id: here.id });
    const outScope = await scopedStaff(`out-${n}@example.test`, "viewer", { type: "operation", id: there.id });
    expect(code(await c.fleet.getEquipmentImage.execute({ actor: inScope, id: e.equipment.id }))).toBe("ok");
    expect(code(await c.fleet.getEquipmentImage.execute({ actor: outScope, id: e.equipment.id }))).toBe("not_found");
    expect(code(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: randomUUID() }))).toBe("not_found");
    expect(code(await c.fleet.getEquipmentImage.execute({ actor: adminActor, id: "not-a-uuid" }))).toBe("not_found");
  });

  it("two concurrent replaces of one equipment end with one row, the second one seeing the first", async () => {
    for (let round = 0; round < 4; round += 1) {
      const e = await createEquipment(`Race ${String(round)}`, jpegA);
      const run = (bytes: Uint8Array) => c.fleet.updateEquipment.execute(editInput(e, { image: { action: "replace", bytes } }));
      const results = await Promise.all([run(png), run(jpegB)]);
      expect(results.map(code)).toEqual(["ok", "ok"]);
      const rows = await rowsOf(e.equipment.id);
      expect(rows).toHaveLength(1);
      const entries = await auditOf(e.equipment.id, "fleet.equipment.update");
      expect(entries).toHaveLength(2);
      expect(entries[1]?.before?.imageHash).toBe(entries[0]?.after?.imageHash);
      expect(rows[0]?.sha256).toBe(entries[1]?.after?.imageHash);
    }
  });

  it("a concurrent replace and remove end consistent: the row matches the last audit entry", async () => {
    const e = await createEquipment("RaceRemove", jpegA);
    const replace = c.fleet.updateEquipment.execute(editInput(e, { image: { action: "replace", bytes: png } }));
    const remove = c.fleet.updateEquipment.execute(editInput(e, { image: { action: "remove" } }));
    expect((await Promise.all([replace, remove])).map(code)).toEqual(["ok", "ok"]);
    const entries = await auditOf(e.equipment.id, "fleet.equipment.update");
    const last = entries[1]?.after?.imageHash ?? null;
    expect((await rowsOf(e.equipment.id))[0]?.sha256 ?? null).toBe(last);
  });
});

describe("the list never reads the image bytes", () => {
  it("lists and gets equipment without any statement selecting the data column", async () => {
    await createEquipment("NoData", jpegA);
    const statements: string[] = [];
    const spy = postgres(url.toString(), {
      max: 2, onnotice: () => undefined, connection: { role: APP_ROLE },
      debug: (_connection, query) => { statements.push(query); },
    });
    try {
      const probe = createContainer(spy, { hasher });
      const listed = must(await probe.fleet.listEquipment.execute({ actor: adminActor }));
      must(await probe.fleet.getEquipment.execute({ actor: adminActor, id: listed[0]?.id ?? "" }));
      const touching = statements.filter((statement) => statement.includes("equipment_images"));
      expect(touching.length).toBeGreaterThan(0);
      expect(touching.filter((statement) => /\bdata\b/i.test(statement))).toEqual([]);
      const before = statements.length;
      must(await probe.fleet.getEquipmentImage.execute({ actor: adminActor, id: listed[0]?.id ?? "" }));
      expect(statements.slice(before).some((statement) => /\bdata\b/i.test(statement))).toBe(true);
    } finally {
      await spy.end();
    }
  });
});
