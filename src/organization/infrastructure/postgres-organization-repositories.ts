import type { TransactionSql } from "postgres";
import type {
  BusinessUnitRepository,
  OperationRepository,
  OperationSiteRepository,
  SiteRepository,
} from "../application/ports/repositories";
import type { BusinessUnit, Operation, OperationSite, Site } from "../domain/entities";
import { compareByName } from "./row-order";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets lookups answer "not found" for a malformed id instead of a cast error. */
const isUuid = (value: string): boolean => UUID.test(value);

type NamedRow = { id: string; tenant_id: string; name: string };
type OperationRow = NamedRow & { business_unit_id: string };

const toNamed = (row: NamedRow): BusinessUnit => ({ id: row.id, tenantId: row.tenant_id, name: row.name });
const toOperation = (row: OperationRow): Operation => ({ ...toNamed(row), businessUnitId: row.business_unit_id });

/** Same contract as the in-memory fake: renaming a row that does not exist is a programming error. */
const expectOneRow = (count: number, id: string): void => {
  if (count !== 1) throw new Error(`rename of a missing row ${id}`);
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

  async add(unit: BusinessUnit): Promise<void> {
    await this.sql`insert into business_units (id, tenant_id, name) values (${unit.id}, ${unit.tenantId}, ${unit.name})`;
  }

  async rename(tenantId: string, id: string, name: string): Promise<void> {
    const result = await this.sql`update business_units set name = ${name} where tenant_id = ${tenantId} and id = ${id}`;
    expectOneRow(result.count, id);
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
      select id, tenant_id, business_unit_id, name from operations where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toOperation(rows[0]) : null;
  }

  async findByName(tenantId: string, businessUnitId: string, key: string): Promise<Operation | null> {
    if (!isUuid(tenantId) || !isUuid(businessUnitId)) return null;
    const rows = await this.sql<OperationRow[]>`
      select id, tenant_id, business_unit_id, name from operations
      where tenant_id = ${tenantId} and business_unit_id = ${businessUnitId}
        and name_key = organization_name_key(${key})`;
    return rows[0] ? toOperation(rows[0]) : null;
  }

  async add(operation: Operation): Promise<void> {
    await this.sql`
      insert into operations (id, tenant_id, business_unit_id, name)
      values (${operation.id}, ${operation.tenantId}, ${operation.businessUnitId}, ${operation.name})`;
  }

  async rename(tenantId: string, id: string, name: string): Promise<void> {
    const result = await this.sql`update operations set name = ${name} where tenant_id = ${tenantId} and id = ${id}`;
    expectOneRow(result.count, id);
  }

  async listByTenant(tenantId: string): Promise<readonly Operation[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<OperationRow[]>`
      select id, tenant_id, business_unit_id, name from operations where tenant_id = ${tenantId}`;
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

  async add(site: Site): Promise<void> {
    await this.sql`insert into sites (id, tenant_id, name) values (${site.id}, ${site.tenantId}, ${site.name})`;
  }

  async rename(tenantId: string, id: string, name: string): Promise<void> {
    const result = await this.sql`update sites set name = ${name} where tenant_id = ${tenantId} and id = ${id}`;
    expectOneRow(result.count, id);
  }

  async listByTenant(tenantId: string): Promise<readonly Site[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<NamedRow[]>`select id, tenant_id, name from sites where tenant_id = ${tenantId}`;
    return rows.map(toNamed).sort(compareByName);
  }
}

type LinkRow = { tenant_id: string; operation_id: string; site_id: string };

const toLink = (row: LinkRow): OperationSite => ({
  tenantId: row.tenant_id,
  operationId: row.operation_id,
  siteId: row.site_id,
});

export class PostgresOperationSiteRepository implements OperationSiteRepository {
  constructor(private readonly sql: TransactionSql) {}

  async find(tenantId: string, operationId: string, siteId: string): Promise<OperationSite | null> {
    if (!isUuid(tenantId) || !isUuid(operationId) || !isUuid(siteId)) return null;
    const rows = await this.sql<LinkRow[]>`
      select tenant_id, operation_id, site_id from operation_sites
      where tenant_id = ${tenantId} and operation_id = ${operationId} and site_id = ${siteId}`;
    return rows[0] ? toLink(rows[0]) : null;
  }

  async add(link: OperationSite): Promise<void> {
    await this.sql`
      insert into operation_sites (tenant_id, operation_id, site_id)
      values (${link.tenantId}, ${link.operationId}, ${link.siteId})`;
  }

  async listByTenant(tenantId: string): Promise<readonly OperationSite[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<LinkRow[]>`
      select tenant_id, operation_id, site_id from operation_sites
      where tenant_id = ${tenantId} order by created_at, operation_id, site_id`;
    return rows.map(toLink);
  }
}
