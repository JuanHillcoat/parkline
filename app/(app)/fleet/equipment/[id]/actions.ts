"use server";

import { toActor } from "../../../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../../../src/shared/infrastructure/container";
import { field, type ActionState } from "../../../../_lib/action-state";
import { assignFields, correctFields, endFields, moveFields, replaceFields } from "../../../../_lib/assignment-form";
import { equipmentFields } from "../../../../_lib/fleet-form";
import { runMutation } from "../../../../_lib/run-action";

const fleet = () => getContainer().fleet;

/** Every form of the detail page carries the equipment it was opened from; the page revalidates itself. */
const pathOf = (form: FormData, name = "equipmentId"): string => `/fleet/equipment/${field(form, name)}`;

export async function assignEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => fleet().assignEquipment.execute({ actor: toActor(actor), ...assignFields(form) }));
}

export async function moveEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => fleet().moveEquipment.execute({ actor: toActor(actor), ...moveFields(form) }));
}

export async function replaceEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => fleet().replaceEquipment.execute({ actor: toActor(actor), ...replaceFields(form) }));
}

export async function endAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => fleet().endAssignment.execute({ actor: toActor(actor), ...endFields(form) }));
}

export async function correctAssignmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => fleet().correctAssignment.execute({ actor: toActor(actor), ...correctFields(form) }));
}

/** The same use cases as the board's edit, archive and restore, but they refresh the detail page. */
export async function updateEquipmentFromDetailAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form, "id"), (actor) =>
    fleet().updateEquipment.execute({
      actor: toActor(actor),
      id: field(form, "id"),
      reason: field(form, "reason"),
      ...equipmentFields(form),
    }),
  );
}

export async function archiveEquipmentFromDetailAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form, "id"), (actor) =>
    fleet().archiveEquipment.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}

export async function restoreEquipmentFromDetailAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form, "id"), (actor) =>
    fleet().restoreEquipment.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}
