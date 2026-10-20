import { ActionDialog, type DialogAction } from "../../_components/action-dialog";
import { NameField, ReasonField, type Option } from "../../_components/form-fields";
import { copy } from "../../_lib/copy";
import type { AssetTypeRow } from "../../_lib/fleet-view";
import {
  archiveAssetTypeAction,
  archiveEquipmentAction,
  archiveSupplierAction,
  createAssetTypeAction,
  createSupplierAction,
  renameSupplierAction,
  restoreAssetTypeAction,
  restoreEquipmentAction,
  restoreSupplierAction,
  updateAssetTypeAction,
} from "./actions";
import { MeterFields } from "./meter-fields";

export function NewSupplierDialog() {
  const t = copy.dialogs.newSupplier;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title}
      description={t.description} submitLabel={t.submit} action={createSupplierAction}>
      <NameField id="new-supplier-name" label={t.nameLabel} hint={t.nameHint} placeholder={t.namePlaceholder} />
    </ActionDialog>
  );
}

/** The quick typo fix: no reason, like renaming in the organization screen. */
export function RenameSupplierDialog({ target }: { target: Option }) {
  const t = copy.dialogs.rename;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.name)}
      description={t.description} submitLabel={t.submit} action={renameSupplierAction}>
      <input type="hidden" name="id" value={target.id} />
      <NameField id={`rename-supplier-${target.id}`} label={t.nameLabel} hint={t.nameHint} initial={target.name} />
    </ActionDialog>
  );
}

export function NewAssetTypeDialog() {
  const t = copy.dialogs.newAssetType;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title}
      description={t.description} submitLabel={t.submit} action={createAssetTypeAction}>
      <NameField id="new-asset-type-name" label={t.nameLabel} hint={t.nameHint} placeholder={t.namePlaceholder} />
      <MeterFields idPrefix="new-asset-type" initialKind="hours" initialInterval="" />
    </ActionDialog>
  );
}

/** Edits every field of an asset type. The reason is mandatory and the change is audited (ADR-0007). */
export function EditAssetTypeDialog({ target }: { target: AssetTypeRow }) {
  const t = copy.dialogs.editAssetType;
  const key = `edit-asset-type-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.name)}
      description={t.description} submitLabel={t.submit} action={updateAssetTypeAction}>
      <input type="hidden" name="id" value={target.id} />
      <NameField id={`${key}-name`} label={t.nameLabel} hint={t.nameHint} initial={target.form.name} />
      <MeterFields idPrefix={key} initialKind={target.form.meterKind} initialInterval={target.form.interval} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

export type FleetKind = "supplier" | "assetType" | "equipment";

const ARCHIVE_ACTIONS = {
  archive: { supplier: archiveSupplierAction, assetType: archiveAssetTypeAction, equipment: archiveEquipmentAction },
  restore: { supplier: restoreSupplierAction, assetType: restoreAssetTypeAction, equipment: restoreEquipmentAction },
} satisfies Record<"archive" | "restore", Record<FleetKind, DialogAction>>;

type ArchiveDialogProps = { readonly kind: FleetKind; readonly verb: "archive" | "restore"; readonly target: Option };

/** Archives or restores one row. The reason is mandatory and audited (ADR-0004, ADR-0007). */
export function ArchiveDialog({ kind, verb, target }: ArchiveDialogProps) {
  const t = copy.dialogs[verb];
  const description = copy.dialogs[verb === "archive" ? "archiveFleet" : "restoreFleet"].description;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.name)}
      danger={verb === "archive"} description={description} submitLabel={t.submit}
      action={ARCHIVE_ACTIONS[verb][kind]}>
      <input type="hidden" name="id" value={target.id} />
      <ReasonField id={`${verb}-${kind}-${target.id}`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
