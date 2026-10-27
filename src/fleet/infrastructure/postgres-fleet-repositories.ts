import type { TransactionSql } from "postgres";
import type {
  AssetTypeRepository,
  EquipmentAdd,
  EquipmentRepository,
  EquipmentUpdate,
  ParentLock,
  SetArchivedAt,
  SetEquipmentArchivedAt,
  SupplierRepository,
} from "../application/ports/repositories";
import type { AssetType, Equipment, Supplier } from "../domain/entities";
import type { BatteryKind, MeterKind } from "../domain/values";
import {
  assetTypeConflictOf,
  equipmentConflictOf,
  supplierConflictOf,
  uniqueViolationIndex,
} from "./postgres-fleet-conflicts";
import { compareByCode, compareByName } from "./row-order";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets lookups answer "not found" for a malformed id instead of a cast error. */
const isUuid = (value: string): boolean => UUID.test(value);

type SupplierRow = { id: string; tenant_id: string; name: string; archived_at: Date | null };
type AssetTypeRow = SupplierRow & { meter_kind: MeterKind; preventive_interval_hours: number | null };
type EquipmentRow = {
  id: string;
  tenant_id: string;
  supplier_id: string;
  asset_type_id: string;
  internal_code: string;
  brand: string | null;
  model: string | null;
  year: number | null;
  serial_number: string | null;
  battery_kind: BatteryKind | null;
  battery_quantity: number | null;
  observations: string | null;
  archived_at: Date | null;
};

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  tenantId: row.tenant_id,
  name: row.name,
  archivedAt: row.archived_at,
});

const toAssetType = (row: AssetTypeRow): AssetType => ({
  ...toSupplier(row),
  meterKind: row.meter_kind,
  preventiveIntervalHours: row.preventive_interval_hours,
});

const toEquipment = (row: EquipmentRow): Equipment => ({
  id: row.id,
  tenantId: row.tenant_id,
  supplierId: row.supplier_id,
  assetTypeId: row.asset_type_id,
  internalCode: row.internal_code,
  brand: row.brand,
  model: row.model,
  year: row.year,
  serialNumber: row.serial_number,
  batteryKind: row.battery_kind,
  batteryQuantity: row.battery_quantity,
  observations: row.observations,
  archivedAt: row.archived_at,
});

type Update = (scope: TransactionSql) => PromiseLike<{ count: number }>;

/**
 * Runs a write in a savepoint, so a unique violation (a concurrent writer took the name or the
 * code) rolls back only the statement and becomes a value. The index name decides: any other
 * error, even a 23505 on another index, is rethrown.
 */
const attempt = async <C extends string>(
  sql: TransactionSql,
  update: Update,
  conflictOf: (index: string | undefined) => C | null,
): Promise<{ readonly count: number } | C> => {
  try {
    const result = await sql.savepoint(async (scope) => await update(scope));
    return { count: result.count };
  } catch (error) {
    const conflict = conflictOf(uniqueViolationIndex(error));
    if (conflict === null) throw error;
    return conflict;
  }
};

/** The state the row must still be in for the write: active to archive, archived to restore. */
const stateClause = (sql: TransactionSql, archivedAt: Date | null) =>
  archivedAt === null ? sql`archived_at is not null` : sql`archived_at is null`;

/** A rename or update: stored (true) or the name was taken (false); a missing row is a programming error. */
const stored = async (
  sql: TransactionSql,
  id: string,
  update: Update,
  conflictOf: (index: string | undefined) => "name_taken" | null,
): Promise<boolean> => {
  const result = await attempt(sql, update, conflictOf);
  if (typeof result === "string") return false;
  if (result.count !== 1) throw new Error(`update of a missing row ${id}`);
  return true;
};

/** The single copy of the rule: a conflict is passed through, one updated row is done, none means the state changed. */
const archiveOutcome = <C extends string>(result: { readonly count: number } | C): C | "done" | "state_changed" =>
  typeof result === "string" ? result : result.count === 1 ? "done" : "state_changed";

const lockClause = (sql: TransactionSql, mode: ParentLock) => (mode === "share" ? sql`for share` : sql`for update`);

export class PostgresSupplierRepository implements SupplierRepository {
  constructor(private readonly sql: TransactionSql) {}

  async lock(tenantId: string, id: string, mode: ParentLock): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(id)) return;
    await this.sql`select 1 from suppliers where tenant_id = ${tenantId} and id = ${id} ${lockClause(this.sql, mode)}`;
  }

  async findById(tenantId: string, id: string): Promise<Supplier | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<SupplierRow[]>`
      select id, tenant_id, name, archived_at from suppliers where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toSupplier(rows[0]) : null;
  }

  async findManyByIds(tenantId: string, ids: readonly string[]): Promise<readonly Supplier[]> {
    const valid = ids.filter(isUuid);
    if (!isUuid(tenantId) || valid.length === 0) return [];
    const rows = await this.sql<SupplierRow[]>`
      select id, tenant_id, name, archived_at from suppliers where tenant_id = ${tenantId} and id in ${this.sql(valid)}`;
    return rows.map(toSupplier);
  }

  async findByName(tenantId: string, key: string): Promise<Supplier | null> {
    if (!isUuid(tenantId)) return null;
    const rows = await this.sql<SupplierRow[]>`
      select id, tenant_id, name, archived_at from suppliers
      where tenant_id = ${tenantId} and name_key = fleet_name_key(${key}) and archived_at is null`;
    return rows[0] ? toSupplier(rows[0]) : null;
  }

  async add(supplier: Supplier): Promise<boolean> {
    const rows = await this.sql`
      insert into suppliers (id, tenant_id, name) values (${supplier.id}, ${supplier.tenantId}, ${supplier.name})
      on conflict (tenant_id, name_key) where archived_at is null do nothing
      returning id`;
    return rows.length === 1;
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    const update: Update = (s) => s`update suppliers set name = ${name} where tenant_id = ${tenantId} and id = ${id}`;
    return stored(this.sql, id, update, supplierConflictOf);
  }

  async setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt> {
    const result = await attempt(
      this.sql,
      (s) => s`update suppliers set archived_at = ${archivedAt}
               where tenant_id = ${tenantId} and id = ${id} and ${stateClause(s, archivedAt)}`,
      supplierConflictOf,
    );
    return archiveOutcome(result);
  }

  async listByTenant(tenantId: string): Promise<readonly Supplier[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<SupplierRow[]>`
      select id, tenant_id, name, archived_at from suppliers where tenant_id = ${tenantId}`;
    return rows.map(toSupplier).sort(compareByName);
  }
}

export class PostgresAssetTypeRepository implements AssetTypeRepository {
  constructor(private readonly sql: TransactionSql) {}

  async lock(tenantId: string, id: string, mode: ParentLock): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(id)) return;
    await this.sql`select 1 from asset_types where tenant_id = ${tenantId} and id = ${id} ${lockClause(this.sql, mode)}`;
  }

  async findById(tenantId: string, id: string): Promise<AssetType | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<AssetTypeRow[]>`
      select id, tenant_id, name, meter_kind, preventive_interval_hours, archived_at
      from asset_types where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toAssetType(rows[0]) : null;
  }

  async findManyByIds(tenantId: string, ids: readonly string[]): Promise<readonly AssetType[]> {
    const valid = ids.filter(isUuid);
    if (!isUuid(tenantId) || valid.length === 0) return [];
    const rows = await this.sql<AssetTypeRow[]>`
      select id, tenant_id, name, meter_kind, preventive_interval_hours, archived_at
      from asset_types where tenant_id = ${tenantId} and id in ${this.sql(valid)}`;
    return rows.map(toAssetType);
  }

  async findByName(tenantId: string, key: string): Promise<AssetType | null> {
    if (!isUuid(tenantId)) return null;
    const rows = await this.sql<AssetTypeRow[]>`
      select id, tenant_id, name, meter_kind, preventive_interval_hours, archived_at from asset_types
      where tenant_id = ${tenantId} and name_key = fleet_name_key(${key}) and archived_at is null`;
    return rows[0] ? toAssetType(rows[0]) : null;
  }

  async add(type: AssetType): Promise<boolean> {
    const rows = await this.sql`
      insert into asset_types (id, tenant_id, name, meter_kind, preventive_interval_hours)
      values (${type.id}, ${type.tenantId}, ${type.name}, ${type.meterKind}, ${type.preventiveIntervalHours})
      on conflict (tenant_id, name_key) where archived_at is null do nothing
      returning id`;
    return rows.length === 1;
  }

  update(type: AssetType): Promise<boolean> {
    const update: Update = (s) => s`
      update asset_types
      set name = ${type.name}, meter_kind = ${type.meterKind}, preventive_interval_hours = ${type.preventiveIntervalHours}
      where tenant_id = ${type.tenantId} and id = ${type.id}`;
    return stored(this.sql, type.id, update, assetTypeConflictOf);
  }

  async setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetArchivedAt> {
    const result = await attempt(
      this.sql,
      (s) => s`update asset_types set archived_at = ${archivedAt}
               where tenant_id = ${tenantId} and id = ${id} and ${stateClause(s, archivedAt)}`,
      assetTypeConflictOf,
    );
    return archiveOutcome(result);
  }

  async listByTenant(tenantId: string): Promise<readonly AssetType[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<AssetTypeRow[]>`
      select id, tenant_id, name, meter_kind, preventive_interval_hours, archived_at
      from asset_types where tenant_id = ${tenantId}`;
    return rows.map(toAssetType).sort(compareByName);
  }
}

export class PostgresEquipmentRepository implements EquipmentRepository {
  constructor(private readonly sql: TransactionSql) {}

  /**
   * NO KEY UPDATE, the lock `PostgresAssignmentRepository` takes before it writes: it does not block the
   * key-share locks the foreign keys of other tables take. One statement per row, in sorted id order, so
   * the order does not depend on the plan of a multi-row query.
   */
  async lock(tenantId: string, ids: readonly string[]): Promise<void> {
    if (!isUuid(tenantId)) return;
    for (const id of [...new Set(ids.map((value) => value.toLowerCase()))].filter(isUuid).sort()) {
      await this.sql`select 1 from equipments where tenant_id = ${tenantId} and id = ${id} for no key update`;
    }
  }

  private get columns() {
    return this.sql`id, tenant_id, supplier_id, asset_type_id, internal_code, brand, model, year, serial_number, battery_kind, battery_quantity, observations, archived_at`;
  }

  async findById(tenantId: string, id: string): Promise<Equipment | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<EquipmentRow[]>`
      select ${this.columns} from equipments where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toEquipment(rows[0]) : null;
  }

  async findByInternalCode(tenantId: string, supplierId: string, key: string): Promise<Equipment | null> {
    if (!isUuid(tenantId) || !isUuid(supplierId)) return null;
    const rows = await this.sql<EquipmentRow[]>`
      select ${this.columns} from equipments
      where tenant_id = ${tenantId} and supplier_id = ${supplierId}
        and internal_code_key = fleet_name_key(${key}) and archived_at is null`;
    return rows[0] ? toEquipment(rows[0]) : null;
  }

  countActiveBySupplier(tenantId: string, supplierId: string): Promise<number> {
    return this.countActive("supplier_id", tenantId, supplierId);
  }

  countActiveByAssetType(tenantId: string, assetTypeId: string): Promise<number> {
    return this.countActive("asset_type_id", tenantId, assetTypeId);
  }

  private async countActive(column: "supplier_id" | "asset_type_id", tenantId: string, ownerId: string): Promise<number> {
    if (!isUuid(tenantId) || !isUuid(ownerId)) return 0;
    const rows = await this.sql<{ n: number }[]>`
      select count(*)::int as n from equipments
      where tenant_id = ${tenantId} and ${this.sql(column)} = ${ownerId} and archived_at is null`;
    return rows[0]?.n ?? 0;
  }

  /** "on conflict do nothing" on the partial index: the only unique index a new row can hit besides its id. */
  async add(equipment: Equipment): Promise<EquipmentAdd> {
    const rows = await this.sql`
      insert into equipments (id, tenant_id, supplier_id, asset_type_id, internal_code, brand, model, year,
                              serial_number, battery_kind, battery_quantity, observations)
      values (${equipment.id}, ${equipment.tenantId}, ${equipment.supplierId}, ${equipment.assetTypeId},
              ${equipment.internalCode}, ${equipment.brand}, ${equipment.model}, ${equipment.year},
              ${equipment.serialNumber}, ${equipment.batteryKind}, ${equipment.batteryQuantity}, ${equipment.observations})
      on conflict (tenant_id, supplier_id, internal_code_key) where archived_at is null do nothing
      returning id`;
    return rows.length === 1 ? "added" : "internal_code_taken";
  }

  async update(equipment: Equipment): Promise<EquipmentUpdate> {
    const result = await attempt(
      this.sql,
      (s) => s`
        update equipments
        set supplier_id = ${equipment.supplierId}, asset_type_id = ${equipment.assetTypeId},
            internal_code = ${equipment.internalCode}, brand = ${equipment.brand}, model = ${equipment.model},
            year = ${equipment.year}, serial_number = ${equipment.serialNumber},
            battery_kind = ${equipment.batteryKind}, battery_quantity = ${equipment.batteryQuantity}, observations = ${equipment.observations}
        where tenant_id = ${equipment.tenantId} and id = ${equipment.id}`,
      equipmentConflictOf,
    );
    if (typeof result === "string") return "internal_code_taken";
    if (result.count !== 1) throw new Error(`update of a missing row ${equipment.id}`);
    return "updated";
  }

  async setArchivedAt(tenantId: string, id: string, archivedAt: Date | null): Promise<SetEquipmentArchivedAt> {
    const result = await attempt(
      this.sql,
      (s) => s`update equipments set archived_at = ${archivedAt}
               where tenant_id = ${tenantId} and id = ${id} and ${stateClause(s, archivedAt)}`,
      equipmentConflictOf,
    );
    return archiveOutcome(result);
  }

  async listByTenant(tenantId: string): Promise<readonly Equipment[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<EquipmentRow[]>`
      select ${this.columns} from equipments where tenant_id = ${tenantId}`;
    return rows.map(toEquipment).sort(compareByCode);
  }
}
