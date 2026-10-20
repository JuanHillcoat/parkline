import {
  scopeKey,
  type ScopeDirectory,
  type ScopeLabel,
  type ScopeRef,
} from "../../shared/domain/ports/scope-directory";
import type { OrganizationTx } from "../application/ports/organization-tx";
import { isLabeledType, scopeLabel, type LabeledType } from "./scope-labels";

type Row = { name: string; costCenter?: string; archivedAt: Date | null };

/** Anything that can run a read over the committed organization state (the in-memory store). */
export type OrganizationReader = { read<T>(work: (tx: OrganizationTx) => Promise<T>): Promise<T> };

const find = (tx: OrganizationTx, tenantId: string, type: LabeledType, id: string): Promise<Row | null> => {
  if (type === "business_unit") return tx.businessUnits.findById(tenantId, id);
  return type === "operation" ? tx.operations.findById(tenantId, id) : tx.sites.findById(tenantId, id);
};

/** In-memory fake of the Postgres `ScopeDirectory`, over the same organization store. */
export class InMemoryScopeDirectory implements ScopeDirectory {
  constructor(private readonly store: OrganizationReader) {}

  async exists(tenantId: string, scopeType: string, id: string): Promise<boolean> {
    if (scopeType === "tenant") return id === tenantId;
    if (!isLabeledType(scopeType)) return false;
    const row = await this.store.read((tx) => find(tx, tenantId, scopeType, id));
    return row !== null && row.archivedAt === null;
  }

  labels(tenantId: string, scopes: readonly ScopeRef[]): Promise<ReadonlyMap<string, ScopeLabel>> {
    return this.store.read(async (tx) => {
      const labels = new Map<string, ScopeLabel>();
      for (const { type, id } of scopes) {
        if (!isLabeledType(type)) continue;
        const row = await find(tx, tenantId, type, id);
        if (row !== null) labels.set(scopeKey(type, id), scopeLabel(type, row));
      }
      return labels;
    });
  }
}
