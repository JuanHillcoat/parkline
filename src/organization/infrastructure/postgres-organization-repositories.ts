import type { TransactionSql } from "postgres";
import type {
  BusinessUnitRepository,
  OperationAdd,
  OperationRepository,
  SiteRepository,
} from "../application/ports/repositories";
import type { BusinessUnit, Operation, Site } from "../domain/entities";
import { nameKey } from "../domain/name";
import { compareByName } from "./row-order";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets lookups answer "not found" for a malformed id instead of a cast error. */
const isUuid = (value: string): boolean => UUID.test(value);

type NamedRow = { id: string; tenant_id: string; name: string };
type OperationRow = NamedRow & { business_unit_id: string; site_id: string; cost_center: string };

const toNamed = (row: NamedRow): BusinessUnit => ({ id: row.id, tenantId: row.tenant_id, name: row.name });
const toOperation = (row: OperationRow): Operation => ({
  ...toNamed(row),
  businessUnitId: row.business_unit_id,
  siteId: row.site_id,
  costCenter: row.cost_center,
});

const UNIQUE_VIOLATION = "23505";

/**
 * Renames inside a savepoint, so a unique name violation (a concurrent writer took the
 * name) rolls back only the statement and becomes `false`. Same contract as the in-memory
 * fake: renaming a row that does not exist is a programming error.
 */
const renamed = async (
  sql: TransactionSql,
  id: string,
  update: (scope: TransactionSql) => PromiseLike<{ count: number }>,
): Promise<boolean> => {
  try {
    const result = await sql.savepoint(async (scope) => await update(scope));
    if (result.count !== 1) throw new Error(`rename of a missing row ${id}`);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return false;
    throw error;
  }
};

export class PostgresBusinessUnitRepository implements BusinessUnitRepository {
  constructor(private readonly sql: TransactionSql) {}

  async findById(tenantId: string, id: string): Promise<BusinessUnit | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<NamedRow[]>`
      select id, tenant_id, name from business_units where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toNamed(rows[0]) : null;
  }

  async findByName(tenantId: string, key: string): Promise<BusinessUnit | null> {
    if (!isUuid(tenantId)) return null;
    const rows = await this.sql<NamedRow[]>`
      select id, tenant_id, name from business_units
      where tenant_id = ${tenantId} and name_key = organization_name_key(${key})`;
    return rows[0] ? toNamed(rows[0]) : null;
  }

  async add(unit: BusinessUnit): Promise<boolean> {
    const rows = await this.sql`
      insert into business_units (id, tenant_id, name) values (${unit.id}, ${unit.tenantId}, ${unit.name})
      on conflict (tenant_id, name_key) do nothing
      returning id`;
    return rows.length === 1;
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return renamed(this.sql, id, (s) => s`update business_units set name = ${name} where tenant_id = ${tenantId} and id = ${id}`);
  }

  async listByTenant(tenantId: string): Promise<readonly BusinessUnit[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<NamedRow[]>`select id, tenant_id, name from business_units where tenant_id = ${tenantId}`;
    return rows.map(toNamed).sort(compareByName);
  }
}

export class PostgresOperationRepository implements OperationRepository {
  constructor(private readonly sql: TransactionSql) {}

  async findById(tenantId: string, id: string): Promise<Operation | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<OperationRow[]>`
      select id, tenant_id, business_unit_id, site_id, name, cost_center
      from operations where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toOperation(rows[0]) : null;
  }

  async findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null> {
    if (!isUuid(tenantId) || !isUuid(businessUnitId)) return null;
    const rows = await this.sql<OperationRow[]>`
      select id, tenant_id, business_unit_id, site_id, name, cost_center from operations
      where tenant_id = ${tenantId} and business_unit_id = ${businessUnitId}
        and name_key = organization_name_key(${key})`;
    return rows[0] ? toOperation(rows[0]) : null;
  }

  async findByCostCenter(tenantId: string, costCenter: string): Promise<Operation | null> {
    if (!isUuid(tenantId)) return null;
    const rows = await this.sql<OperationRow[]>`
      select id, tenant_id, business_unit_id, site_id, name, cost_center
      from operations where tenant_id = ${tenantId} and cost_center = ${costCenter}`;
    return rows[0] ? toOperation(rows[0]) : null;
  }

  /**
   * "on conflict do nothing" swallows a violation of either unique index (name per division,
   * cost center per tenant); a follow-up lookup tells which one took the row. The lookup is a
   * new statement, so it sees the concurrent writer's committed row.
   */
  async add(operation: Operation): Promise<OperationAdd> {
    const rows = await this.sql`
      insert into operations (id, tenant_id, business_unit_id, site_id, name, cost_center)
      values (${operation.id}, ${operation.tenantId}, ${operation.businessUnitId}, ${operation.siteId},
              ${operation.name}, ${operation.costCenter})
      on conflict do nothing
      returning id`;
    return rows.length === 1 ? "added" : this.whyRejected(operation);
  }

  private async whyRejected(operation: Operation): Promise<Exclude<OperationAdd, "added">> {
    const sameName = await this.findByName(operation.tenantId, operation.businessUnitId, nameKey(operation.name));
    if (sameName !== null) return "name_taken";
    if ((await this.findByCostCenter(operation.tenantId, operation.costCenter)) !== null) return "cost_center_taken";
    throw new Error("operation insert skipped without a name or cost center conflict");
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return renamed(this.sql, id, (s) => s`update operations set name = ${name} where tenant_id = ${tenantId} and id = ${id}`);
  }

  async listByTenant(tenantId: string): Promise<readonly Operation[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<OperationRow[]>`
      select id, tenant_id, business_unit_id, site_id, name, cost_center
      from operations where tenant_id = ${tenantId}`;
    return rows.map(toOperation).sort(compareByName);
  }
}

export class PostgresSiteRepository implements SiteRepository {
  constructor(private readonly sql: TransactionSql) {}

  async findById(tenantId: string, id: string): Promise<Site | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<NamedRow[]>`
      select id, tenant_id, name from sites where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toNamed(rows[0]) : null;
  }

  async findByName(tenantId: string, key: string): Promise<Site | null> {
    if (!isUuid(tenantId)) return null;
    const rows = await this.sql<NamedRow[]>`
      select id, tenant_id, name from sites
      where tenant_id = ${tenantId} and name_key = organization_name_key(${key})`;
    return rows[0] ? toNamed(rows[0]) : null;
  }

  async add(site: Site): Promise<boolean> {
    const rows = await this.sql`
      insert into sites (id, tenant_id, name) values (${site.id}, ${site.tenantId}, ${site.name})
      on conflict (tenant_id, name_key) do nothing
      returning id`;
    return rows.length === 1;
  }

  rename(tenantId: string, id: string, name: string): Promise<boolean> {
    return renamed(this.sql, id, (s) => s`update sites set name = ${name} where tenant_id = ${tenantId} and id = ${id}`);
  }

  async listByTenant(tenantId: string): Promise<readonly Site[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<NamedRow[]>`select id, tenant_id, name from sites where tenant_id = ${tenantId}`;
    return rows.map(toNamed).sort(compareByName);
  }
}
