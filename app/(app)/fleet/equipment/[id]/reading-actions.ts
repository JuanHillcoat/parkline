"use server";

import { toActor } from "../../../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../../../src/shared/infrastructure/container";
import { field, type ActionState } from "../../../../_lib/action-state";
import { correctReadingFields, recordFields, replaceMeterFields } from "../../../../_lib/readings-form";
import { runMutation } from "../../../../_lib/run-action";

const metering = () => getContainer().metering;

/** Every form of the readings tab carries the equipment it was opened from; the page revalidates itself. */
const pathOf = (form: FormData): string => `/fleet/equipment/${field(form, "equipmentId")}`;

export async function recordReadingAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => metering().recordReading.execute({ actor: toActor(actor), ...recordFields(form) }));
}

export async function correctReadingAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => metering().correctReading.execute({ actor: toActor(actor), ...correctReadingFields(form) }));
}

export async function replaceMeterAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(pathOf(form), (actor) => metering().replaceMeter.execute({ actor: toActor(actor), ...replaceMeterFields(form) }));
}
