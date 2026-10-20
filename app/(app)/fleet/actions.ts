"use server";

import { toActor } from "../../../src/identity/application/actor-mapper";
import type { DomainError } from "../../../src/shared/domain/domain-error";
import type { Actor } from "../../../src/shared/domain/ports/access-policy";
import type { Result } from "../../../src/shared/domain/result";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { field, type ActionState } from "../../_lib/action-state";
import { assetTypeFields, equipmentFields } from "../../_lib/fleet-form";
import { runMutation } from "../../_lib/run-action";

const fleet = () => getContainer().fleet;
const PATH = "/fleet";

type ArchiveInput = { readonly actor: Actor; readonly id: string; readonly reason: string };
type ArchiveUseCase = { execute(input: ArchiveInput): Promise<Result<unknown, DomainError>> };

/** Archive and restore share one shape: the row id and a mandatory reason. */
const changeArchive = (form: FormData, pick: (useCases: ReturnType<typeof fleet>) => ArchiveUseCase) =>
  runMutation(PATH, (actor) =>
    pick(fleet()).execute({ actor: toActor(actor), id: field(form, "id"), reason: field(form, "reason") }),
  );

export async function createSupplierAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    fleet().createSupplier.execute({ actor: toActor(actor), name: field(form, "name") }),
  );
}

export async function renameSupplierAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    fleet().renameSupplier.execute({ actor: toActor(actor), id: field(form, "id"), name: field(form, "name") }),
  );
}

export async function createAssetTypeAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    fleet().createAssetType.execute({ actor: toActor(actor), ...assetTypeFields(form) }),
  );
}

export async function updateAssetTypeAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    fleet().updateAssetType.execute({
      actor: toActor(actor),
      id: field(form, "id"),
      reason: field(form, "reason"),
      ...assetTypeFields(form),
    }),
  );
}

export async function createEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    fleet().createEquipment.execute({ actor: toActor(actor), ...equipmentFields(form) }),
  );
}

export async function updateEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return runMutation(PATH, (actor) =>
    fleet().updateEquipment.execute({
      actor: toActor(actor),
      id: field(form, "id"),
      reason: field(form, "reason"),
      ...equipmentFields(form),
    }),
  );
}

export async function archiveSupplierAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeArchive(form, (f) => f.archiveSupplier);
}

export async function archiveAssetTypeAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeArchive(form, (f) => f.archiveAssetType);
}

export async function archiveEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeArchive(form, (f) => f.archiveEquipment);
}

export async function restoreSupplierAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeArchive(form, (f) => f.restoreSupplier);
}

export async function restoreAssetTypeAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeArchive(form, (f) => f.restoreAssetType);
}

export async function restoreEquipmentAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  return changeArchive(form, (f) => f.restoreEquipment);
}
