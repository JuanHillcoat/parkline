import { ForbiddenError, NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { AccessPolicy, Actor } from "../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../shared/domain/result";
import type { AssetType, Supplier } from "../domain/entities";
import { ArchivedError, InternalCodeTakenError, NameTakenError, ParentArchivedError } from "../domain/errors";
import type { AuditFields } from "./audit";
import type { FleetTx } from "./ports/fleet-tx";

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
 * Every fleet position is the tenant (D7), so authorization needs no row. It runs right after the
 * active check and before any lookup, so a refused actor cannot tell missing ids from existing ones.
 * Returns the role that granted the permission.
 */
export const authorize = (policy: AccessPolicy, actor: Actor, permission: string): Result<string, DomainError> =>
  policy.check(actor, permission, { tenantId: actor.tenantId });

/**
 * The answer for a row that is not there. When authorization needs the row's position it cannot run
 * before the lookup; to keep ids from being probed, a missing row answers exactly like a row the actor
 * cannot reach (forbidden) unless the actor holds the permission tenant-wide, who could act on any row
 * and may be told the typed `error` (same pattern as issue 16 in the organization module).
 */
export const missingRow = (
  policy: AccessPolicy,
  actor: Actor,
  permission: string,
  error: DomainError,
): Result<never, DomainError> => {
  const tenantWide = policy.check(actor, permission, { tenantId: actor.tenantId });
  return tenantWide.ok ? err(error) : tenantWide;
};

/** D6: fleet rows sit at the tenant, so only a tenant-wide `catalog.read` sees them; scoped readers see none. */
export const canReadFleet = (policy: AccessPolicy, actor: Actor): boolean =>
  policy.check(actor, "catalog.read", { tenantId: actor.tenantId }).ok;

/** The `includeArchived` flag counts only for an actor holding `catalog.archive` tenant-wide; else it is ignored. */
export const mayIncludeArchived = (policy: AccessPolicy, actor: Actor, requested: boolean | undefined): boolean =>
  requested === true && policy.check(actor, "catalog.archive", { tenantId: actor.tenantId }).ok;

/** Active rows only, unless archived ones were asked for (and allowed). */
export const withArchived = <T extends { readonly archivedAt: Date | null }>(
  rows: readonly T[],
  include: boolean,
): readonly T[] => (include ? rows : rows.filter((row) => row.archivedAt === null));

/** A match under the same owner is a conflict, unless it is the entity being renamed. */
export const requireFreeName = (
  found: { readonly id: string } | null,
  name: string,
  selfId?: string,
): Result<void, DomainError> => (found !== null && found.id !== selfId ? nameTaken(name) : ok(undefined));

/** The same conflict, when the repository reports that the unique name index rejected the write. */
export const nameTaken = (name: string): Result<never, DomainError> =>
  err(new NameTakenError(`"${name}" is already in use`));

/** An internal code is unique per tenant and supplier among active rows. */
export const internalCodeTaken = (code: string): Result<never, DomainError> =>
  err(new InternalCodeTakenError(`The internal code ${code} is already in use by this supplier`));

/** The same check for a pre-read: a match other than the equipment itself is a conflict. */
export const requireFreeCode = (
  found: { readonly id: string } | null,
  code: string,
  selfId?: string,
): Result<void, DomainError> => (found !== null && found.id !== selfId ? internalCodeTaken(code) : ok(undefined));

/** An archived row cannot be renamed or edited until it is restored. */
export const archivedRow = (kind: string, id: string): Result<never, DomainError> =>
  err(new ArchivedError(`${kind} ${id} is archived`));

export const parentArchived = (): Result<never, DomainError> =>
  err(new ParentArchivedError("The supplier or the asset type is archived"));

export type Parents = { readonly supplier: Supplier; readonly assetType: AssetType };

/**
 * An equipment cannot be created, moved or restored under a missing or archived supplier or asset type.
 * Share-locks the supplier, then the asset type (always this order), before reading their `archivedAt`.
 */
export const loadActiveParents = async (
  tx: FleetTx,
  tenantId: string,
  supplierId: string,
  assetTypeId: string,
): Promise<Result<Parents, DomainError>> => {
  await tx.suppliers.lock(tenantId, supplierId, "share");
  await tx.assetTypes.lock(tenantId, assetTypeId, "share");
  const supplier = await tx.suppliers.findById(tenantId, supplierId);
  if (supplier === null) return err(new NotFoundError("Supplier", supplierId));
  const assetType = await tx.assetTypes.findById(tenantId, assetTypeId);
  if (assetType === null) return err(new NotFoundError("Asset type", assetTypeId));
  return supplier.archivedAt !== null || assetType.archivedAt !== null ? parentArchived() : ok({ supplier, assetType });
};

type ActorFields = Pick<AuditFields, "actorId" | "actorKind" | "actorRole" | "tenantId">;

/** The actor columns every fleet audit entry shares; `role` is the one the policy returned. */
export const auditActor = (actor: Actor, role: string): ActorFields => ({
  actorId: actor.userId,
  actorKind: "user",
  actorRole: role,
  tenantId: actor.tenantId,
});
