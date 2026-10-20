import { ActionDialog, type DialogAction } from "../../_components/action-dialog";
import { NameField, ReasonField, SelectField, type Option } from "../../_components/form-fields";
import { copy } from "../../_lib/copy";
import type { OperationRow } from "../../_lib/organization-view";
import {
  createDivisionAction,
  createOperationAction,
  archiveDivisionAction,
  archiveOperationAction,
  archiveSiteAction,
  createSiteAction,
  renameDivisionAction,
  renameOperationAction,
  renameSiteAction,
  restoreDivisionAction,
  restoreOperationAction,
  restoreSiteAction,
  updateOperationAction,
} from "./actions";

function CostCenterField({ id, initial }: { id: string; initial?: string }) {
  const t = copy.dialogs.newOperation;
  return (
    <div className="field">
      <label htmlFor={id}>{t.costCenterLabel}</label>
      <input id={id} name="costCenter" type="text" required inputMode="numeric"
        maxLength={4} pattern="[0-9]{4}" placeholder={t.costCenterPlaceholder} className="input"
        autoComplete="off" defaultValue={initial} />
      <span className="hint">{t.costCenterHint}</span>
    </div>
  );
}

export function NewDivisionDialog() {
  const t = copy.dialogs.newDivision;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title}
      description={t.description} submitLabel={t.submit} action={createDivisionAction}>
      <NameField id="new-division-name" label={t.nameLabel} hint={t.nameHint} placeholder={t.namePlaceholder} />
    </ActionDialog>
  );
}

type NewOperationProps = { readonly divisions: readonly Option[]; readonly sites: readonly Option[] };

export function NewOperationDialog({ divisions, sites }: NewOperationProps) {
  const t = copy.dialogs.newOperation;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title}
      description={t.description} submitLabel={t.submit} action={createOperationAction}>
      <NameField id="new-operation-name" label={t.nameLabel} hint={t.nameHint} placeholder={t.namePlaceholder} />
      <SelectField id="new-operation-division" name="businessUnitId" label={t.divisionLabel}
        prompt={t.selectDivision} options={divisions} />
      <SelectField id="new-operation-site" name="siteId" label={t.siteLabel} prompt={t.selectSite}
        options={sites} hint={t.siteHint} />
      <CostCenterField id="new-operation-cost-center" />
    </ActionDialog>
  );
}

export type EditOptions = { readonly divisions: readonly Option[]; readonly sites: readonly Option[] };

type EditOperationProps = { readonly target: OperationRow; readonly options: EditOptions };

/** Edits every field of an operation. The reason is mandatory and the change is audited (ADR-0004). */
export function EditOperationDialog({ target, options }: EditOperationProps) {
  const t = copy.dialogs.editOperation;
  const key = `edit-operation-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.name)}
      description={t.description} submitLabel={t.submit} action={updateOperationAction}>
      <input type="hidden" name="id" value={target.id} />
      <NameField id={`${key}-name`} label={t.nameLabel} hint={t.nameHint} initial={target.name} />
      <SelectField id={`${key}-division`} name="businessUnitId" label={t.divisionLabel}
        prompt={t.selectDivision} options={options.divisions} initial={target.businessUnitId} />
      <SelectField id={`${key}-site`} name="siteId" label={t.siteLabel} prompt={t.selectSite}
        options={options.sites} initial={target.siteId} />
      <CostCenterField id={`${key}-cost-center`} initial={target.costCenter} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

export function NewSiteDialog() {
  const t = copy.dialogs.newSite;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title}
      description={t.description} submitLabel={t.submit} action={createSiteAction}>
      <NameField id="new-site-name" label={t.nameLabel} hint={t.nameHint} placeholder={t.namePlaceholder} />
    </ActionDialog>
  );
}

const RENAME_ACTIONS = {
  division: renameDivisionAction,
  operation: renameOperationAction,
  site: renameSiteAction,
} satisfies Record<string, DialogAction>;

export type RenameKind = keyof typeof RENAME_ACTIONS;

export function RenameDialog({ kind, target }: { kind: RenameKind; target: Option }) {
  const t = copy.dialogs.rename;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.name)}
      description={t.description} submitLabel={t.submit} action={RENAME_ACTIONS[kind]}>
      <input type="hidden" name="id" value={target.id} />
      <NameField id={`rename-${kind}-${target.id}`} label={t.nameLabel} hint={t.nameHint} initial={target.name} />
    </ActionDialog>
  );
}

const ARCHIVE_ACTIONS = {
  archive: { division: archiveDivisionAction, operation: archiveOperationAction, site: archiveSiteAction },
  restore: { division: restoreDivisionAction, operation: restoreOperationAction, site: restoreSiteAction },
} satisfies Record<"archive" | "restore", Record<RenameKind, DialogAction>>;

type ArchiveDialogProps = { readonly kind: RenameKind; readonly verb: "archive" | "restore"; readonly target: Option };

/** Archives or restores one row. The reason is mandatory and audited (ADR-0004, ADR-0006). */
export function ArchiveDialog({ kind, verb, target }: ArchiveDialogProps) {
  const t = copy.dialogs[verb];
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.name)}
      danger={verb === "archive"} description={t.description} submitLabel={t.submit}
      action={ARCHIVE_ACTIONS[verb][kind]}>
      <input type="hidden" name="id" value={target.id} />
      <ReasonField id={`${verb}-${kind}-${target.id}`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
