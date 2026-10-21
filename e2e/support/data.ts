/**
 * Test data helpers: reset the catalogs between suites and seed rows through the application
 * use cases. Both talk to the ephemeral database as its owner, using the connection stored in
 * the world file, so the development database is unreachable from here.
 *
 * What survives `resetCatalogs()`: the world's users, their sessions and role assignments, the
 * world's own division, site and operation (kept by id, so the scoped users keep valid
 * assignments) and the append-only `audit_log`. Suites must not edit or archive the world's
 * organization rows; they create their own rows with the seeder instead.
 */
import postgres, { type Sql } from "postgres";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { DomainError } from "../../src/shared/domain/domain-error";
import type { Actor } from "../../src/shared/domain/ports/access-policy";
import type { Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";
import { WORLD_USERS, passwordOf, readWorld, type WorldFile } from "./world";

const openOwner = (): Sql => postgres(readWorld().ownerUrl, { max: 2, onnotice: () => undefined });

async function deleteTestUsers(sql: Sql): Promise<void> {
  const keep = Object.values(WORLD_USERS).map((user) => user.email);
  const users = sql`select id from users where email <> all(${keep})`;
  await sql`delete from sessions where user_id in (${users})`;
  await sql`delete from user_role_assignments where user_id in (${users})`;
  await sql`delete from users where email <> all(${keep})`;
}

async function deleteTestOrganization(sql: Sql, ids: WorldFile["ids"]): Promise<void> {
  await sql`delete from operations where id <> ${ids.operation}`;
  await sql`delete from sites where id <> ${ids.site}`;
  await sql`delete from business_units where id <> ${ids.division}`;
}

/**
 * Deletes everything a suite created: users other than the world's (with their sessions and
 * assignments), the failed sign-in counters, equipments, asset types, suppliers, operations,
 * sites and divisions, in foreign-key order.
 */
export async function resetCatalogs(): Promise<void> {
  const sql = openOwner();
  try {
    const { ids } = readWorld();
    await deleteTestUsers(sql);
    await sql`delete from sign_in_attempts`;
    await sql`delete from equipments`;
    await sql`delete from asset_types`;
    await sql`delete from suppliers`;
    await deleteTestOrganization(sql, ids);
  } finally {
    await sql.end();
  }
}

function must<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw new Error(`Seeding failed: ${result.error.code}`);
  return result.value;
}

export type EquipmentSeed = {
  readonly supplierId: string;
  readonly assetTypeId: string;
  readonly internalCode: string;
  readonly brand?: string;
  readonly model?: string;
  readonly year?: number;
};

export type OperationSeed = { division: string; site: string; name: string; costCenter: string };

export type Seeder = {
  readonly division: (name: string) => Promise<string>;
  readonly site: (name: string) => Promise<string>;
  readonly operation: (input: OperationSeed) => Promise<string>;
  readonly supplier: (name: string) => Promise<string>;
  readonly assetType: (name: string, meterKind?: string, intervalHours?: number | null) => Promise<string>;
  readonly equipment: (input: EquipmentSeed) => Promise<string>;
  readonly close: () => Promise<void>;
};

function organizationSeeds(c: Container, actor: Actor) {
  return {
    division: async (name: string) => must(await c.organization.createBusinessUnit.execute({ actor, name })).id,
    site: async (name: string) => must(await c.organization.createSite.execute({ actor, name })).id,
    operation: async (input: OperationSeed) =>
      must(
        await c.organization.createOperation.execute({
          actor,
          businessUnitId: input.division,
          siteId: input.site,
          name: input.name,
          costCenter: input.costCenter,
        }),
      ).id,
  };
}

function fleetSeeds(c: Container, actor: Actor) {
  return {
    supplier: async (name: string) => must(await c.fleet.createSupplier.execute({ actor, name })).id,
    assetType: async (name: string, meterKind = "hours", intervalHours: number | null = null) =>
      must(await c.fleet.createAssetType.execute({ actor, name, meterKind, preventiveIntervalHours: intervalHours })).id,
    equipment: async (input: EquipmentSeed) =>
      must(
        await c.fleet.createEquipment.execute({
          actor,
          supplierId: input.supplierId,
          assetTypeId: input.assetTypeId,
          internalCode: input.internalCode,
          brand: input.brand ?? null,
          model: input.model ?? null,
          year: input.year ?? null,
          serialNumber: null,
          batteryQuantity: null,
          observations: null,
        }),
      ).id,
  };
}

/**
 * Opens a seeder that creates rows through the use cases as the world's administrator, so audit
 * entries, normalization and validation are the real ones. Always `close()` it.
 */
export async function openSeeder(): Promise<Seeder> {
  const sql = openOwner();
  const c = createContainer(sql);
  const session = must(await c.identity.signIn.execute({ email: WORLD_USERS.admin.email, password: passwordOf("admin") }));
  const actor = toActor(must(await c.identity.authenticate.execute({ token: session.token })));
  return { ...organizationSeeds(c, actor), ...fleetSeeds(c, actor), close: () => sql.end() };
}
