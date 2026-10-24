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
 * Whether the actor may open the fleet screen: it holds `catalog.read` through any active assignment, at any
 * scope. Equipment is visible by its open assignment (D6, P0-08), so a scoped reader sees the equipment placed
 * inside its scope; the list use case decides which rows.
 */
export const canViewFleet = canReadCatalog;

/**
 * Whether the actor holds `catalog.read` at company scope. Suppliers and asset types stay tenant-wide (D6 of
 * ADR-0007): only these readers see their tabs, counts and dialogs, and the supplier and asset type cards and
 * distributions of the dashboard.
 */
export const canViewFleetCatalogs = ({ user, assignments }: ActorContext): boolean =>
  user.active && assignments.some((a) => a.active && a.scope.type === "tenant" && roleGrants(a.role, "catalog.read"));
