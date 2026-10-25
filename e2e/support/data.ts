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
 * assignments), the failed sign-in counters, equipment assignments, meter readings, meters, equipments, asset types, suppliers, operations,
 * sites and divisions, in foreign-key order.
 */
export async function resetCatalogs(): Promise<void> {
  const sql = openOwner();
  try {
    const { ids } = readWorld();
    await deleteTestUsers(sql);
    await sql`delete from sign_in_attempts`;
    await sql`delete from equipment_assignments`;
    await sql`delete from meter_readings`;
    await sql`delete from meters`;
    await sql`delete from equipment_images`;
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

/** Today is the default start day: a past day would need a reason, a future one hides nothing. */
export type AssignmentSeed = {
  readonly equipmentId: string;
  readonly operationId: string;
  readonly kind?: "active" | "spare";
  readonly day?: string;
  readonly reason?: string;
};

/** Moves the open assignment: it ends the day before `day` and a new one starts on `day`. */
export type MoveSeed = { readonly equipmentId: string; readonly operationId: string; readonly day: string; readonly reason: string };

/** Closes the open assignment on `day` (its last day). */
export type EndSeed = { readonly equipmentId: string; readonly day: string; readonly reason: string };

/** Replaces the meter of an equipment on `day`: the old one ends at `finalValue`, the new one starts at `initialValue`. */
export type MeterReplacementSeed = {
  readonly equipmentId: string;
  readonly day: string;
  readonly finalValue: number;
  readonly initialValue: number;
  readonly reason: string;
};

export type OperationSeed = { division: string; site: string; name: string; costCenter: string };

export type Seeder = {
  readonly division: (name: string) => Promise<string>;
  readonly site: (name: string) => Promise<string>;
  readonly operation: (input: OperationSeed) => Promise<string>;
  readonly supplier: (name: string) => Promise<string>;
  readonly assetType: (name: string, meterKind?: string, intervalHours?: number | null) => Promise<string>;
  readonly equipment: (input: EquipmentSeed) => Promise<string>;
  /** Sets (or replaces) the image of an equipment through the edit use case; `bytes` must be a valid JPEG, PNG or WebP. */
  readonly equipmentImage: (equipmentId: string, bytes: Uint8Array) => Promise<void>;
  readonly assign: (input: AssignmentSeed) => Promise<void>;
  readonly move: (input: MoveSeed) => Promise<void>;
  readonly end: (input: EndSeed) => Promise<void>;
  /** Archives an equipment that has no open assignment. */
  readonly archiveEquipment: (equipmentId: string, reason: string) => Promise<void>;
  /** Records a reading as the world's administrator; the first one opens the meter. */
  readonly reading: (equipmentId: string, day: string, value: number) => Promise<void>;
  readonly replaceMeter: (input: MeterReplacementSeed) => Promise<void>;
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
          brand: input.brand ?? "MARCA",
          model: input.model ?? "MODELO",
          year: input.year ?? null,
          serialNumber: null,
          batteryQuantity: null,
          observations: null,
        }),
      ).id,
    equipmentImage: async (equipmentId: string, bytes: Uint8Array) => {
      const e = must(await c.fleet.getEquipment.execute({ actor, id: equipmentId }));
      must(
        await c.fleet.updateEquipment.execute({
          actor,
          id: e.id,
          reason: "Seed image",
          supplierId: e.supplierId,
          assetTypeId: e.assetTypeId,
          internalCode: e.internalCode,
          brand: e.brand,
          model: e.model,
          year: e.year,
          serialNumber: e.serialNumber,
          batteryQuantity: e.batteryQuantity,
          observations: e.observations,
          image: { action: "replace", bytes },
        }),
      );
    },
  };
}

const today = (): string => new Date().toISOString().slice(0, 10);

function assignmentSeeds(c: Container, actor: Actor, analyst: Actor) {
  return {
    assign: async (input: AssignmentSeed) => {
      must(
        await c.fleet.assignEquipment.execute({
          actor,
          equipmentId: input.equipmentId,
          operationId: input.operationId,
          kind: input.kind ?? "active",
          day: input.day ?? today(),
          reason: input.reason ?? null,
        }),
      );
    },
    move: async (input: MoveSeed) => {
      must(await c.fleet.moveEquipment.execute({ actor, ...input }));
    },
    end: async (input: EndSeed) => {
      must(await c.fleet.endAssignment.execute({ actor, ...input }));
    },
    // Only the fleet analyst holds `catalog.archive`, so the archive runs as the world's analyst.
    archiveEquipment: async (equipmentId: string, reason: string) => {
      must(await c.fleet.archiveEquipment.execute({ actor: analyst, id: equipmentId, reason }));
    },
  };
}

function meteringSeeds(c: Container, actor: Actor) {
  return {
    reading: async (equipmentId: string, day: string, value: number) => {
      must(await c.metering.recordReading.execute({ actor, equipmentId, day, value }));
    },
    replaceMeter: async (input: MeterReplacementSeed) => {
      must(await c.metering.replaceMeter.execute({ actor, ...input }));
    },
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
  const analystSession = must(await c.identity.signIn.execute({ email: WORLD_USERS.fleet_analyst.email, password: passwordOf("fleet_analyst") }));
  const analyst = toActor(must(await c.identity.authenticate.execute({ token: analystSession.token })));
  return { ...organizationSeeds(c, actor), ...fleetSeeds(c, actor), ...assignmentSeeds(c, actor, analyst), ...meteringSeeds(c, actor), close: () => sql.end() };
}
