import { err, ok, type Result } from "../../shared/domain/result";
import type { RoleAssignment } from "../domain/role-assignment";
import type { User } from "../domain/user";
import { ReasonRequiredError } from "./errors";
import type { IdentityTx } from "./ports/identity-tx";

export const requireReason = (reason: string): Result<string, ReasonRequiredError> => {
  const trimmed = reason.trim();
  return trimmed === "" ? err(new ReasonRequiredError()) : ok(trimmed);
};

/** Same user, role and scope: the natural key of an active assignment. */
export const sameGrant = (a: RoleAssignment, b: RoleAssignment): boolean =>
  a.userId === b.userId &&
  a.role === b.role &&
  a.scope.type === b.scope.type &&
  a.scope.id === b.scope.id;

const isAdmin =(assignment: RoleAssignment): boolean =>
  assignment.active && assignment.role === "admin";

/** True when `target` is active, holds admin and is the only such user of the tenant. */
export const isLastActiveAdmin = async (tx: IdentityTx, target: User): Promise<boolean> => {
  if (!target.active) return false;
  const own = await tx.assignments.listActiveByUser(target.tenantId, target.id);
  if (!own.some(isAdmin)) return false;
  return (await tx.assignments.countActiveAdminUsers(target.tenantId)) <= 1;
};

/** Compact snapshot of a user's roles for audit `before` and `after`. */
export const rolesSnapshot = (assignments: readonly RoleAssignment[]) => ({
  roles: assignments.map((a) => ({ role: a.role, scope: a.scope })),
});
