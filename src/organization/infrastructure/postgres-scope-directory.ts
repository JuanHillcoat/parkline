import type { Sql } from "postgres";
import {
  scopeKey,
  type ScopeDirectory,
  type ScopeLabel,
  type ScopeRef,
} from "../../shared/domain/ports/scope-directory";
import { isLabeledType, LABELED_TYPES, scopeLabel, type LabeledType } from "./scope-labels";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LabelRow = { id: string; name: string; cost_center?: string; archived_at: Date | null };

/**
 * Reads the organization tables by tenant and id. It runs outside the identity unit of work
 * (a lookup, not a write); the foreign keys of migration 0005 still protect a race with an
 * archive or a delete. Malformed ids answer false or no label instead of a cast error.
 */
export class PostgresScopeDirectory implements ScopeDirectory {
  constructor(private readonly sql: Sql) {}

  async exists(tenantId: string, scopeType: string, id: string): Promise<boolean> {
    if (scopeType === "tenant") return id === tenantId;
    if (!isLabeledType(scopeType) || !UUID.test(tenantId) || !UUID.test(id)) return false;
    const rows = await this.rowsOf(scopeType, tenantId, [id]);
    return rows.some((row) => row.archived_at === null);
  }

  async labels(tenantId: string, scopes: readonly ScopeRef[]): Promise<ReadonlyMap<string, ScopeLabel>> {
    const labels = new Map<string, ScopeLabel>();
    if (!UUID.test(tenantId)) return labels;
    for (const type of LABELED_TYPES) {
      const ids = scopes.filter((s) => s.type === type && UUID.test(s.id)).map((s) => s.id);
      if (ids.length === 0) continue;
      for (const row of await this.rowsOf(type, tenantId, ids)) {
        const costCenter = row.cost_center;
        labels.set(scopeKey(type, row.id), scopeLabel(type, { name: row.name, costCenter, archivedAt: row.archived_at }));
      }
    }
    return labels;
  }

  private rowsOf(type: LabeledType, tenantId: string, ids: readonly string[]): Promise<LabelRow[]> {
    const list = this.sql(ids);
    if (type === "business_unit") {
      return this.sql<LabelRow[]>`
        select id, name, archived_at from business_units where tenant_id = ${tenantId} and id in ${list}`;
    }
    if (type === "operation") {
      return this.sql<LabelRow[]>`
        select id, name, cost_center, archived_at from operations where tenant_id = ${tenantId} and id in ${list}`;
    }
    return this.sql<LabelRow[]>`
      select id, name, archived_at from sites where tenant_id = ${tenantId} and id in ${list}`;
  }
}
