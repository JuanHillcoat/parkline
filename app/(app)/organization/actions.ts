"use server";

import { toActor } from "../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { field, type ActionState } from "../../_lib/action-state";
import { runMutation } from "../../_lib/run-action";

const organization = () => getContainer().organization;
const PATH = "/organization";

export async function createDivisionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().createBusinessUnit.execute({ actor: toActor(actor), name: field(form, "name") }),
  );
}

export async function createOperationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().createOperation.execute({
      actor: toActor(actor),
      name: field(form, "name"),
      businessUnitId: field(form, "businessUnitId"),
      siteId: field(form, "siteId"),
      costCenter: field(form, "costCenter"),
    }),
  );
}

export async function createSiteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().createSite.execute({ actor: toActor(actor), name: field(form, "name") }),
  );
}

export async function renameDivisionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().renameBusinessUnit.execute({ actor: toActor(actor), id: field(form, "id"), name: field(form, "name") }),
  );
}

export async function renameOperationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().renameOperation.execute({ actor: toActor(actor), id: field(form, "id"), name: field(form, "name") }),
  );
}

export async function renameSiteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().renameSite.execute({ actor: toActor(actor), id: field(form, "id"), name: field(form, "name") }),
  );
}
