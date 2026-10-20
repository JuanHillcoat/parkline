import type { DomainError } from "../../shared/domain/domain-error";
import { scopeKey } from "../../shared/domain/ports/scope-directory";
import { err, ok, type Result } from "../../shared/domain/result";
import type { Role } from "../domain/role";
import { parseScopeType, type Scope } from "../domain/scope";
import type { IdentityDeps } from "./deps";
import { ScopeNotAllowedForRoleError, ScopeNotFoundError } from "./errors";

/** A scope as a caller states it: strings from a form, validated here. */
export type RawScope = { readonly type: string; readonly id: string };

/** A scope that passed the rules, with its display name when it has one (the tenant scope has none). */
export type ResolvedScope = { readonly scope: Scope; readonly name?: string };

/**
 * Decision D2: `admin` only holds the tenant scope; every other role may hold the tenant, a division,
 * an operation or a site. The target must exist, be active and belong to the actor's tenant. Without
 * a scope the tenant scope is used, so callers written before scopes existed keep working.
 */
export const resolveScope = async (
  deps: Pick<IdentityDeps, "scopes">,
  tenantId: string,
  role: Role,
  raw?: RawScope,
): Promise<Result<ResolvedScope, DomainError>> => {
  if (raw === undefined) return ok({ scope: { type: "tenant", id: tenantId } });
  const type = parseScopeType(raw.type);
  if (!type.ok) return type;
  const scope: Scope = { type: type.value, id: raw.id.trim() };
  if (role === "admin" && scope.type !== "tenant") return err(new ScopeNotAllowedForRoleError(role, scope.type));
  if (scope.type === "tenant") {
    return (await deps.scopes.exists(tenantId, scope.type, scope.id))
      ? ok({ scope })
      : err(new ScopeNotFoundError(scope.type, scope.id));
  }
  // One lookup for the other levels: a label that exists and is not archived means the scope is usable.
  const label = (await deps.scopes.labels(tenantId, [scope])).get(scopeKey(scope.type, scope.id));
  if (label === undefined || label.archived) return err(new ScopeNotFoundError(scope.type, scope.id));
  return ok({ scope, name: label.name });
};

/** Audit names by scope key for `rolesSnapshot`. */
export const scopeNames = (resolved: ResolvedScope): ReadonlyMap<string, string> =>
  resolved.name === undefined
    ? new Map()
    : new Map([[scopeKey(resolved.scope.type, resolved.scope.id), resolved.name]]);
