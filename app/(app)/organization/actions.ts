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

export async function updateOperationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().updateOperation.execute({
      actor: toActor(actor),
      operationId: field(form, "id"),
      name: field(form, "name"),
      businessUnitId: field(form, "businessUnitId"),
      siteId: field(form, "siteId"),
      costCenter: field(form, "costCenter"),
      reason: field(form, "reason"),
    }),
  );
}

export async function renameSiteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().renameSite.execute({ actor: toActor(actor), id: field(form, "id"), name: field(form, "name") }),
  );
}

export async function archiveDivisionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().archiveBusinessUnit.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}

export async function archiveSiteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().archiveSite.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}

export async function archiveOperationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().archiveOperation.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}

export async function restoreDivisionAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().restoreBusinessUnit.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}

export async function restoreSiteAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().restoreSite.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}

export async function restoreOperationAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    organization().restoreOperation.execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );
}
