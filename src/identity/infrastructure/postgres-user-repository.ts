import type { TransactionSql } from "postgres";
import type { StoredUser, UserRepository } from "../application/ports/user-repository";
import type { User } from "../domain/user";
import { isUuid, toUser, type UserRow } from "./postgres-rows";

export class PostgresUserRepository implements UserRepository {
  constructor(private readonly sql: TransactionSql) {}

  async findById(tenantId: string, id: string): Promise<User | null> {
    if (!isUuid(tenantId) || !isUuid(id)) return null;
    const rows = await this.sql<UserRow[]>`
      select id, tenant_id, email, display_name, active
      from users where tenant_id = ${tenantId} and id = ${id}`;
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(tenantId: string, email: string): Promise<StoredUser | null> {
    if (!isUuid(tenantId)) return null;
    const rows = await this.sql<(UserRow & { password_hash: string })[]>`
      select id, tenant_id, email, display_name, active, password_hash
      from users where tenant_id = ${tenantId} and email = ${email}`;
    const row = rows[0];
    return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
  }

  async listByTenant(tenantId: string): Promise<readonly User[]> {
    if (!isUuid(tenantId)) return [];
    const rows = await this.sql<UserRow[]>`
      select id, tenant_id, email, display_name, active
      from users where tenant_id = ${tenantId}
      order by lower(display_name) collate "und-x-icu", id`;
    return rows.map(toUser);
  }

  async add(user: User, passwordHash: string): Promise<boolean> {
    const rows = await this.sql`
      insert into users (id, tenant_id, email, display_name, password_hash, active)
      values (${user.id}, ${user.tenantId}, ${user.email}, ${user.displayName},
              ${passwordHash}, ${user.active})
      on conflict (tenant_id, email) do nothing
      returning id`;
    return rows.length === 1;
  }

  async setActive(tenantId: string, id: string, active: boolean): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(id)) return;
    await this.sql`update users set active = ${active} where tenant_id = ${tenantId} and id = ${id}`;
  }
}
