import { ForbiddenError, NotFoundError, type DomainError } from "../../shared/domain/domain-error";
import type { Actor, ResourcePosition } from "../../shared/domain/ports/access-policy";
import type { EquipmentInfo } from "../../shared/domain/ports/equipment-directory";
import { err, ok, type Result } from "../../shared/domain/result";
import { EquipmentArchivedError, NoMeterError } from "../domain/errors";
import type { MeteringDeps } from "./deps";
import type { MeteringTx } from "./ports/metering-tx";

/** An inactive actor is refused before any lookup, so it learns nothing about the equipment. */
export const whenActive = <T>(
  actor: Actor,
  run: () => Promise<Result<T, DomainError>>,
): Promise<Result<T, DomainError>> =>
  actor.active ? run() : Promise.resolve(err(new ForbiddenError(`User ${actor.userId} is inactive`)));

/** An equipment that passed the checks, with the role that granted the permission and the position it was checked at. */
export type Access = { readonly info: EquipmentInfo; readonly role: string; readonly position: ResourcePosition };

/** Authorization for an equipment sits at its open assignment; without one only company-wide grants reach it (ADR-0010 D6). */
const positionOf = (actor: Actor, info: EquipmentInfo): ResourcePosition => info.position ?? { tenantId: actor.tenantId };

const notFound = (id: string): Result<never, DomainError> => err(new NotFoundError("Equipment", id));

/**
 * D7 and the issue 16 pattern: a missing equipment and an equipment the actor cannot read at its position
 * answer the same `not_found`; only an actor who can see it is told it lacks `permission` (`forbidden`).
 */
const decide = (
  deps: MeteringDeps,
  actor: Actor,
  id: string,
  info: EquipmentInfo | null,
  permission: string,
): Result<Access, DomainError> => {
  if (info === null) return notFound(id);
  const position = positionOf(actor, info);
  if (!deps.accessPolicy.check(actor, "catalog.read", position).ok) return notFound(id);
  const role = deps.accessPolicy.check(actor, permission, position);
  return role.ok ? ok({ info, role: role.value, position }) : role;
};

/** A reader: `catalog.read` at the open assignment, no lock. */
export const authorizeRead = async (
  tx: MeteringTx,
  deps: MeteringDeps,
  actor: Actor,
  id: string,
): Promise<Result<Access, DomainError>> =>
  decide(deps, actor, id, await tx.equipment.find(actor.tenantId, id, { lock: false }), "catalog.read");

/**
 * A writer (D10): authorize on an unlocked read first, so a refused actor never waits on a lock, then take
 * the equipment row lock and decide again on the locked row, which another writer may have just changed.
 */
export const authorizeWrite = async (
  tx: MeteringTx,
  deps: MeteringDeps,
  actor: Actor,
  id: string,
  permission: string,
): Promise<Result<Access, DomainError>> => {
  const first = decide(deps, actor, id, await tx.equipment.find(actor.tenantId, id, { lock: false }), permission);
  if (!first.ok) return first;
  return decide(deps, actor, id, await tx.equipment.find(actor.tenantId, id, { lock: true }), permission);
};

/** A writer needs a meter to exist for the type, and an equipment that is not archived. */
export const requireWritable = (info: EquipmentInfo): Result<"hours" | "km", DomainError> => {
  if (info.archived) return err(new EquipmentArchivedError());
  return info.meterKind === "none" ? err(new NoMeterError()) : ok(info.meterKind);
};
