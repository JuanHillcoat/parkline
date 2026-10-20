import type { UserGrant } from "../../src/identity/application/use-cases/list-users";
import type { BusinessUnit, Operation } from "../../src/organization/domain/entities";
import { copy } from "./copy";
import { ROLE_LABELS } from "./messages";

/** The levels the screen offers. The site level exists in the domain but is not offered here. */
export type ScopeKind = "tenant" | "business_unit" | "operation";

export type DivisionOption = { readonly id: string; readonly name: string };
export type OperationOption = {
  readonly id: string;
  readonly name: string;
  readonly costCenter: string;
  readonly businessUnitId: string;
};
export type ScopeOptions = {
  readonly divisions: readonly DivisionOption[];
  readonly operations: readonly OperationOption[];
};

/** What the selectors offer when the actor cannot read the catalog: only the whole company. */
export const EMPTY_SCOPE_OPTIONS: ScopeOptions = { divisions: [], operations: [] };

const byText = (a: string, b: string): number => a.localeCompare(b, "es");

/** Active divisions by name; active operations of those divisions by cost center. */
export const buildScopeOptions = (
  units: readonly BusinessUnit[],
  operations: readonly Operation[],
): ScopeOptions => {
  const divisions = units
    .filter((unit) => unit.archivedAt === null)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => byText(a.name, b.name));
  const known = new Set(divisions.map((division) => division.id));
  const offered = operations
    .filter((operation) => operation.archivedAt === null && known.has(operation.businessUnitId))
    .map(({ id, name, costCenter, businessUnitId }) => ({ id, name, costCenter, businessUnitId }))
    .sort((a, b) => byText(a.costCenter, b.costCenter));
  return { divisions, operations: offered };
};

/** The state of the role and scope selectors; the ids are empty strings when nothing is chosen. */
export type ScopeSelection = {
  readonly role: string;
  /** `unresolved`: the current scope cannot be offered; the operator must choose one. */
  readonly kind: ScopeKind | "unresolved";
  readonly divisionId: string;
  readonly operationId: string;
};

type CurrentScope = { readonly scopeType: string; readonly scopeId: string };

const COMPANY = (role: string): ScopeSelection => ({ role, kind: "tenant", divisionId: "", operationId: "" });

const resolvedScope = (role: string, current: CurrentScope, options: ScopeOptions): ScopeSelection | null => {
  if (current.scopeType === "business_unit" && options.divisions.some((d) => d.id === current.scopeId)) {
    return { role, kind: "business_unit", divisionId: current.scopeId, operationId: "" };
  }
  const operation = options.operations.find((o) => o.id === current.scopeId);
  if (current.scopeType === "operation" && operation !== undefined) {
    return { role, kind: "operation", divisionId: operation.businessUnitId, operationId: operation.id };
  }
  return null;
};

/**
 * Preselects the user's current scope. A scope the selectors cannot represent (a site, an archived or
 * unreadable division or operation) is `unresolved`, never the company: submitting must not widen it.
 */
export const initialSelection = (
  role: string,
  current: CurrentScope | undefined,
  options: ScopeOptions,
): ScopeSelection => {
  if (current === undefined || current.scopeType === "tenant") return COMPANY(role);
  return resolvedScope(role, current, options) ?? { ...COMPANY(role), kind: "unresolved" };
};

/** The administrator role only holds the company scope. */
export const withRole = (state: ScopeSelection, role: string): ScopeSelection =>
  role === "admin" ? COMPANY(role) : { ...state, role };

export const withKind = (state: ScopeSelection, kind: ScopeKind): ScopeSelection => ({
  ...state,
  kind,
  operationId: "",
});

export const withDivision = (state: ScopeSelection, divisionId: string): ScopeSelection => ({
  ...state,
  divisionId,
  operationId: "",
});

/** The pair submitted with the form; the division of an operation is only a picker step. */
export const scopeValue = (state: ScopeSelection): { readonly type: ScopeKind | ""; readonly id: string } => {
  if (state.kind === "business_unit") return { type: state.kind, id: state.divisionId };
  if (state.kind === "operation") return { type: state.kind, id: state.operationId };
  return { type: state.kind === "unresolved" ? "" : "tenant", id: "" };
};

/**
 * Server side: only an explicit "tenant" takes the actor's tenant id; any other value goes to the use
 * case as is. A missing level is `null`: the company is never assumed.
 */
export const rawScopeFrom = (type: string, id: string, tenantId: string): { type: string; id: string } | null => {
  if (type === "") return null;
  return type === "tenant" ? { type, id: tenantId } : { type, id };
};

const scopeName = (grant: UserGrant): string => {
  if (grant.scopeType === "tenant") return copy.scope.company;
  if (grant.scopeLabel === null) return copy.scope.unknown;
  return grant.scopeLabel.archived ? `${grant.scopeLabel.name} ${copy.scope.archived}` : grant.scopeLabel.name;
};

/** "Gerente · AUTOMOTRIZ": the role with the scope it covers. */
export const grantText = (grant: UserGrant): string => `${ROLE_LABELS[grant.role]} · ${scopeName(grant)}`;
