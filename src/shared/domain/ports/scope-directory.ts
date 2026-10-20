/**
 * A node of the organization hierarchy, as another module names it. Plain strings on
 * purpose: the shared kernel does not know the scope types, only the module that
 * implements `ScopeDirectory` (organization) interprets `division`, `operation` and `site`.
 */
export type ScopeRef = {
  readonly type: string;
  readonly id: string;
};

/** What a screen shows for a scope. An archived row keeps its name and is flagged. */
export type ScopeLabel = {
  readonly name: string;
  readonly archived: boolean;
};

/** Key of a scope in the map returned by `ScopeDirectory.labels`. */
export const scopeKey = (type: string, id: string): string => `${type}:${id}`;

/**
 * Lets a module that grants access (identity) look up the organization nodes it grants
 * access to, without importing the organization module (ADR-0005). Every query is
 * scoped by tenant; a node of another tenant is never visible.
 */
export interface ScopeDirectory {
  /**
   * True only for an ACTIVE (not archived) node of that level in that tenant. The tenant
   * scope exists when the id equals the tenant id. An unknown type or a malformed id is false.
   */
  exists(tenantId: string, scopeType: string, id: string): Promise<boolean>;

  /**
   * Display data of the given nodes in one call, keyed by `scopeKey(type, id)`. Nodes that
   * are missing, belong to another tenant, or have no label (the tenant scope) are absent.
   */
  labels(tenantId: string, scopes: readonly ScopeRef[]): Promise<ReadonlyMap<string, ScopeLabel>>;
}
