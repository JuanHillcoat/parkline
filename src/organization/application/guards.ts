import { ForbiddenError, type DomainError } from "../../shared/domain/domain-error";
import type { AccessPolicy, Actor } from "../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../shared/domain/result";
import { CostCenterTakenError, NameTakenError } from "../domain/errors";
import type { CanRead } from "../domain/visibility";
import type { AuditFields } from "./audit";

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

/** The visibility predicate of D4: `catalog.read` over a position, decided by the shared policy. */
export const canReadAs =
  (policy: AccessPolicy, actor: Actor): CanRead =>
  (position) =>
    policy.check(actor, "catalog.read", position).ok;

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

type ActorFields = Pick<AuditFields, "actorId" | "actorKind" | "actorRole" | "tenantId">;

/** The actor columns every organization audit entry shares; `role` is the one the policy returned. */
export const auditActor = (actor: Actor, role: string): ActorFields => ({
  actorId: actor.userId,
  actorKind: "user",
  actorRole: role,
  tenantId: actor.tenantId,
});
