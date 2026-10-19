"use server";

import { parseRole } from "../../../src/identity/domain/role";
import { ScopeNotFoundError } from "../../../src/identity/application/errors";
import { err } from "../../../src/shared/domain/result";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { field, type ActionState } from "../../_lib/action-state";
import { runMutation } from "../../_lib/run-action";
import { rawScopeFrom } from "../../_lib/user-scope";

const identity = () => getContainer().identity;

/** A missing scope level is rejected, never defaulted to the company. */
const scopeOf = (form: FormData, tenantId: string) =>
  rawScopeFrom(field(form, "scopeType"), field(form, "scopeId"), tenantId) ??
  new ScopeNotFoundError("", field(form, "scopeId"));

export async function createUserAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation("/users", async (actor) => {
    const role = parseRole(field(form, "role"));
    if (!role.ok) return role;
    const scope = scopeOf(form, actor.user.tenantId);
    if (scope instanceof ScopeNotFoundError) return err(scope);
    return identity().createUser.execute({
      actor,
      email: field(form, "email"),
      displayName: field(form, "displayName"),
      password: field(form, "password"),
      role: role.value,
      scope,
    });
  });
}

export async function changeRoleAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation("/users", async (actor) => {
    const scope = scopeOf(form, actor.user.tenantId);
    if (scope instanceof ScopeNotFoundError) return err(scope);
    return identity().changeUserRole.execute({
      actor,
      userId: field(form, "userId"),
      newRole: field(form, "role"),
      scope,
      reason: field(form, "reason"),
    });
  });
}

export async function deactivateUserAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation("/users", (actor) =>
    identity().deactivateUser.execute({
      actor,
      userId: field(form, "userId"),
      reason: field(form, "reason"),
    }),
  );
}
