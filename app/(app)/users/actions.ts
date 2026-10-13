"use server";

import { ROLES, type Role } from "../../../src/identity/domain/role";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { failure, field, type ActionState } from "../../_lib/action-state";
import { runMutation } from "../../_lib/run-action";

const identity = () => getContainer().identity;

export async function createUserAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  const raw = field(form, "role");
  const role = ROLES.find((candidate): candidate is Role => candidate === raw);
  if (role === undefined) return failure("Choose a valid role.");
  return runMutation("/users", (actor) =>
    identity().createUser.execute({
      actor,
      email: field(form, "email"),
      displayName: field(form, "displayName"),
      password: field(form, "password"),
      role,
    }),
  );
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
