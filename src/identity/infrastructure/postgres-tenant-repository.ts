import type { TransactionSql } from "postgres";
import type { TenantRepository } from "../application/ports/tenant-repository";
import type { Tenant } from "../domain/tenant";

/** Same key for every install transaction, so they serialize. */
const INSTALL_LOCK_KEY = "parkline.identity.install";

export class PostgresTenantRepository implements TenantRepository {
  constructor(private readonly sql: TransactionSql) {}

  async lockForInstall(): Promise<void> {
    await this.sql`select pg_advisory_xact_lock(hashtext(${INSTALL_LOCK_KEY}))`;
  }

  async findSingle(): Promise<Tenant | null> {
    const rows = await this.sql<Tenant[]>`
      select id, name from tenants order by created_at, id limit 1`;
    return rows[0] ?? null;
  }

  async add(tenant: Tenant): Promise<void> {
    await this.sql`insert into tenants (id, name) values (${tenant.id}, ${tenant.name})`;
  }
}
