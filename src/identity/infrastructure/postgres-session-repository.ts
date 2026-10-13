import type { TransactionSql } from "postgres";
import type { SessionRepository } from "../application/ports/session-repository";
import type { Session } from "../domain/session";
import { isUuid, toSession, type SessionRow } from "./postgres-rows";

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly sql: TransactionSql) {}

  async add(session: Session): Promise<void> {
    await this.sql`
      insert into sessions
        (id, tenant_id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
      values
        (${session.id}, ${session.tenantId}, ${session.userId}, ${session.tokenHash},
         ${session.createdAt}, ${session.lastSeenAt}, ${session.expiresAt}, ${session.revokedAt})`;
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const rows = await this.sql<SessionRow[]>`
      select id, tenant_id, user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at
      from sessions where token_hash = ${tokenHash}`;
    return rows[0] ? toSession(rows[0]) : null;
  }

  async touch(tenantId: string, id: string, lastSeenAt: Date): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(id)) return;
    await this.sql`
      update sessions set last_seen_at = ${lastSeenAt} where tenant_id = ${tenantId} and id = ${id}`;
  }

  async revoke(tenantId: string, id: string, at: Date): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(id)) return;
    await this.sql`
      update sessions set revoked_at = ${at}
      where tenant_id = ${tenantId} and id = ${id} and revoked_at is null`;
  }

  async revokeAllForUser(tenantId: string, userId: string, at: Date): Promise<void> {
    if (!isUuid(tenantId) || !isUuid(userId)) return;
    await this.sql`
      update sessions set revoked_at = ${at}
      where tenant_id = ${tenantId} and user_id = ${userId} and revoked_at is null`;
  }
}
