import type { TransactionSql } from "postgres";
import type {
  SignInThrottle,
  ThrottleFailure,
  ThrottleSubject,
} from "../application/ports/sign-in-throttle";
import { isUuid } from "./postgres-rows";

type AttemptRow = { subject_kind: "email" | "address"; subject_hash: string; attempted_at: Date };

export class PostgresSignInThrottle implements SignInThrottle {
  constructor(private readonly sql: TransactionSql) {}

  async failuresSince(
    tenantId: string,
    subjects: readonly ThrottleSubject[],
    since: Date,
  ): Promise<readonly ThrottleFailure[]> {
    if (!isUuid(tenantId) || subjects.length === 0) return [];
    const kinds = subjects.map((s) => s.kind);
    const hashes = subjects.map((s) => s.hash);
    const rows = await this.sql<AttemptRow[]>`
      select subject_kind, subject_hash, attempted_at
      from sign_in_attempts
      where tenant_id = ${tenantId}
        and attempted_at > ${since}
        and (subject_kind, subject_hash) in (
          select * from unnest(${kinds}::text[], ${hashes}::text[]))
      order by attempted_at`;
    return rows.map((r) => ({ kind: r.subject_kind, hash: r.subject_hash, at: r.attempted_at }));
  }

  async recordFailure(tenantId: string, subjects: readonly ThrottleSubject[], at: Date): Promise<void> {
    if (!isUuid(tenantId) || subjects.length === 0) return;
    const kinds = subjects.map((s) => s.kind);
    const hashes = subjects.map((s) => s.hash);
    await this.sql`
      insert into sign_in_attempts (tenant_id, subject_kind, subject_hash, attempted_at)
      select ${tenantId}, kind, hash, ${at}
      from unnest(${kinds}::text[], ${hashes}::text[]) as s (kind, hash)`;
  }

  async clear(tenantId: string, subject: ThrottleSubject): Promise<void> {
    if (!isUuid(tenantId)) return;
    await this.sql`
      delete from sign_in_attempts
      where tenant_id = ${tenantId}
        and subject_kind = ${subject.kind} and subject_hash = ${subject.hash}`;
  }

  async prune(tenantId: string, before: Date): Promise<void> {
    if (!isUuid(tenantId)) return;
    await this.sql`
      delete from sign_in_attempts where tenant_id = ${tenantId} and attempted_at <= ${before}`;
  }
}
