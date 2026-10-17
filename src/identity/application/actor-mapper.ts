import type { Actor } from "../../shared/domain/ports/access-policy";
import type { ActorContext } from "./actor-context";

/**
 * Projects identity's `ActorContext` onto the shared-kernel `Actor`. Only the
 * user's own active assignments travel; the policy re-checks them anyway.
 */
export const toActor = ({ user, assignments }: ActorContext): Actor => ({
  userId: user.id,
  tenantId: user.tenantId,
  active: user.active,
  grants: assignments
    .filter((a) => a.active && a.userId === user.id)
    .map((a) => ({ role: a.role, scopeType: a.scope.type, scopeId: a.scope.id })),
});
