import { ForbiddenError, NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { AccessPolicy, Actor } from "../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../shared/domain/result";
import { ArchivedError, CostCenterTakenError, NameTakenError, ParentArchivedError } from "../domain/errors";
import type { CanRead } from "../domain/visibility";
import type { AuditFields } from "./audit";
import type { OrganizationTx } from "./ports/organization-tx";

/** An inactive actor is refused before any lookup, so it learns nothing about the catalog. */
export const requireActive = (actor: Actor): Result<void, DomainError> =>
  actor.active ? ok(undefined) : err(new ForbiddenError(`User ${actor.userId} is inactive`));

/** Runs `run` only for an active actor; every use case starts here. */
export const whenActive = <T>(
  actor: Actor,
  run: () => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> => {
  const active = requireActive(actor);
  return active.ok ? run() : Promise.resolve(active);
};

/**
 * The answer for a row that is not there. Authorization needs the row's position, so it cannot run
 * before the lookup; to keep ids from being probed, a missing row answers exactly like a row the actor
 * cannot reach (forbidden) unless the actor holds the permission tenant-wide, who could act on any row
 * and may be told it does not exist.
 */
export const missingRow = (
  policy: AccessPolicy,
  actor: Actor,
  permission: string,
  kind: string,
  id: string,
): Result<never, DomainError> => {
  const tenantWide = policy.check(actor, permission, { tenantId: actor.tenantId });
  return tenantWide.ok ? err(new NotFoundError(kind, id)) : tenantWide;
};

/** The visibility predicate of D4: `catalog.read` over a position, decided by the shared policy. */
export const canReadAs =
  (policy: AccessPolicy, actor: Actor): CanRead =>
  (position) =>
    policy.check(actor, "catalog.read", position).ok;

/** D6: the `includeArchived` flag counts only for an actor holding `catalog.archive` tenant-wide; else it is ignored. */
export const mayIncludeArchived = (policy: AccessPolicy, actor: Actor, requested: boolean | undefined): boolean =>
  requested === true && policy.check(actor, "catalog.archive", { tenantId: actor.tenantId }).ok;

/** Active rows only, unless archived ones were asked for (and allowed). */
export const withArchived = <T extends { readonly archivedAt: Date | null }>(
  rows: readonly T[],
  include: boolean,
): readonly T[] => (include ? rows : rows.filter((row) => row.archivedAt === null));

/** D7: a match under the same owner is a conflict, unless it is the entity being renamed. */
export const requireFreeName = (
  found: { readonly id: string } | null,
  name: string,
  selfId?: string,
): Result<void, DomainError> => (found !== null && found.id !== selfId ? nameTaken(name) : ok(undefined));

/** The same conflict, when the repository reports that the unique name index rejected the write. */
export const nameTaken = (name: string): Result<never, DomainError> =>
  err(new NameTakenError(`"${name}" is already in use`));

/** D7: a cost center is unique per tenant. */
export const costCenterTaken = (costCenter: string): Result<never, DomainError> =>
  err(new CostCenterTakenError(`The cost center ${costCenter} is already in use`));

/** D7: an archived row cannot be renamed or edited until it is restored. */
export const archivedRow = (kind: string, id: string): Result<never, DomainError> =>
  err(new ArchivedError(`${kind} ${id} is archived`));

/** D4: an operation cannot be created, moved or restored under an archived division or site. */
/** Share-locks the division, then the site (always this order), before the caller reads their `archivedAt`. */
export const lockParents = async (tx: OrganizationTx, tenantId: string, businessUnitId: string, siteId: string): Promise<void> => {
  await tx.businessUnits.lock(tenantId, businessUnitId, "share");
  await tx.sites.lock(tenantId, siteId, "share");
};

export const parentArchived =(): Result<never, DomainError> =>
  err(new ParentArchivedError("The division or the site is archived"));

type ActorFields = Pick<AuditFields, "actorId" | "actorKind" | "actorRole" | "tenantId">;

/** The actor columns every organization audit entry shares; `role` is the one the policy returned. */
export const auditActor = (actor: Actor, role: string): ActorFields => ({
  actorId: actor.userId,
  actorKind: "user",
  actorRole: role,
  tenantId: actor.tenantId,
});
