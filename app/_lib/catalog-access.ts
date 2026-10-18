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
