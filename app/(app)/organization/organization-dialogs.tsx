import { ActionDialog, type DialogAction } from "../../_components/action-dialog";
import { copy } from "../../_lib/copy";
import type { OperationRow } from "../../_lib/organization-view";
import {
  createDivisionAction,
  createOperationAction,
  createSiteAction,
  renameDivisionAction,
  renameOperationAction,
  renameSiteAction,
  updateOperationAction,
} from "./actions";

type Option = { readonly id: string; readonly name: string };

function NameField(props: { id: string; label: string; hint: string; placeholder?: string; initial?: string }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} name="name" type="text" required defaultValue={props.initial}
        placeholder={props.placeholder} className="input" autoComplete="off" />
      <span className="hint">{props.hint}</span>
    </div>
  );
}

type SelectProps = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly prompt: string;
  readonly options: readonly Option[];
  readonly hint?: string;
  readonly initial?: string;
};

function SelectField(props: SelectProps) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} name={props.name} required defaultValue={props.initial ?? ""} className="input">
        <option value="" disabled>{props.prompt}</option>
        {props.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      {props.hint !== undefined && <span className="hint">{props.hint}</span>}
    </div>
  );
}

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

function ReasonField({ id }: { id: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{copy.common.reason}</label>
      <textarea id={id} name="reason" required rows={3} placeholder={copy.dialogs.editOperation.reasonPlaceholder}
        className="input" />
      <span className="hint">{copy.common.reasonHint}</span>
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
      <ReasonField id={`${key}-reason`} />
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
