"use server";

import { parseRole } from "../../../src/identity/domain/role";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { field, type ActionState } from "../../_lib/action-state";
import { runMutation } from "../../_lib/run-action";

const identity = () => getContainer().identity;

export async function createUserAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation("/users", async (actor) => {
    const role = parseRole(field(form, "role"));
    if (!role.ok) return role;
    return identity().createUser.execute({
      actor,
      email: field(form, "email"),
      displayName: field(form, "displayName"),
      password: field(form, "password"),
      role: role.value,
    });
  });
}

export async function changeRoleAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation("/users", (actor) =>
    identity().changeUserRole.execute({
      actor,
      userId: field(form, "userId"),
      newRole: field(form, "role"),
      reason: field(form, "reason"),
    }),
  );
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
