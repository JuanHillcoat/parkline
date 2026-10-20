import {
  scopeKey,
  type ScopeDirectory,
  type ScopeLabel,
  type ScopeRef,
} from "../../../../shared/domain/ports/scope-directory";

type Node = ScopeLabel & { readonly tenantId: string };

/** A hand-filled `ScopeDirectory` for identity tests; the organization module is never imported. */
export class FakeScopeDirectory implements ScopeDirectory {
  private readonly nodes = new Map<string, Node>();
  /** How many times `labels` ran, to prove the users list asks once for all users. */
  labelCalls = 0;

  add(tenantId: string, type: string, id: string, name: string, archived = false): void {
    this.nodes.set(scopeKey(type, id), { tenantId, name, archived });
  }

  exists(tenantId: string, scopeType: string, id: string): Promise<boolean> {
    if (scopeType === "tenant") return Promise.resolve(id === tenantId);
    const node = this.nodes.get(scopeKey(scopeType, id));
    return Promise.resolve(node !== undefined && node.tenantId === tenantId && !node.archived);
  }

  labels(tenantId: string, scopes: readonly ScopeRef[]): Promise<ReadonlyMap<string, ScopeLabel>> {
    this.labelCalls += 1;
    const labels = new Map<string, ScopeLabel>();
    for (const { type, id } of scopes) {
      const node = this.nodes.get(scopeKey(type, id));
      if (node !== undefined && node.tenantId === tenantId) {
        labels.set(scopeKey(type, id), { name: node.name, archived: node.archived });
      }
    }
    return Promise.resolve(labels);
  }
}
