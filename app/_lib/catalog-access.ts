import type { ActorContext } from "../../src/identity/application/actor-context";
import { roleGrants } from "../../src/identity/domain/permission";

/**
 * Whether the actor holds `catalog.read` through any active assignment, at any
 * scope. Visibility of each row is decided by the list use cases, so a user with
 * an operation-only scope still gets the page (tenant-wide `requirePermission`
 * would wrongly lock them out).
 */
export const canReadCatalog = ({ user, assignments }: ActorContext): boolean =>
  user.active && assignments.some((a) => a.active && roleGrants(a.role, "catalog.read"));

/**
 * Whether the actor holds `catalog.read` at company scope. Equipment has no operation
 * yet (decision D6, ADR-0007), so scoped readers would only see empty lists: the
 * fleet screen and its menu entry are for company-wide readers.
 */
export const canViewFleet = ({ user, assignments }: ActorContext): boolean =>
  user.active && assignments.some((a) => a.active && a.scope.type === "tenant" && roleGrants(a.role, "catalog.read"));
