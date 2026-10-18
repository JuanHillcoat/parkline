import { ActionDialog, type DialogAction } from "../../_components/action-dialog";
import { copy } from "../../_lib/copy";
import {
  createDivisionAction,
  createOperationAction,
  createSiteAction,
  renameDivisionAction,
  renameOperationAction,
  renameSiteAction,
} from "./actions";

type Option = { readonly id: string; readonly name: string };

function NameField(props: { id: string; label: string; placeholder?: string; initial?: string }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} name="name" type="text" required defaultValue={props.initial}
        placeholder={props.placeholder} className="input" autoComplete="off" />
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
};

function SelectField(props: SelectProps) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} name={props.name} required defaultValue="" className="input">
        <option value="" disabled>{props.prompt}</option>
        {props.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
      {props.hint !== undefined && <span className="hint">{props.hint}</span>}
    </div>
  );
}

function CostCenterField() {
  const t = copy.dialogs.newOperation;
  return (
    <div className="field">
      <label htmlFor="new-operation-cost-center">{t.costCenterLabel}</label>
      <input id="new-operation-cost-center" name="costCenter" type="text" required inputMode="numeric"
        maxLength={4} pattern="[0-9]{4}" placeholder={t.costCenterPlaceholder} className="input"
        autoComplete="off" />
      <span className="hint">{t.costCenterHint}</span>
    </div>
  );
}

export function NewDivisionDialog() {
  const t = copy.dialogs.newDivision;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title}
      description={t.description} submitLabel={t.submit} action={createDivisionAction}>
      <NameField id="new-division-name" label={t.nameLabel} placeholder={t.namePlaceholder} />
    </ActionDialog>
  );
}

type NewOperationProps = { readonly divisions: readonly Option[]; readonly sites: readonly Option[] };

export function NewOperationDialog({ divisions, sites }: NewOperationProps) {
  const t = copy.dialogs.newOperation;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title}
      description={t.description} submitLabel={t.submit} action={createOperationAction}>
      <NameField id="new-operation-name" label={t.nameLabel} placeholder={t.namePlaceholder} />
      <SelectField id="new-operation-division" name="businessUnitId" label={t.divisionLabel}
        prompt={t.selectDivision} options={divisions} />
      <SelectField id="new-operation-site" name="siteId" label={t.siteLabel} prompt={t.selectSite}
        options={sites} hint={t.siteHint} />
      <CostCenterField />
    </ActionDialog>
  );
}

export function NewSiteDialog() {
  const t = copy.dialogs.newSite;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title}
      description={t.description} submitLabel={t.submit} action={createSiteAction}>
      <NameField id="new-site-name" label={t.nameLabel} placeholder={t.namePlaceholder} />
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
      <NameField id={`rename-${kind}-${target.id}`} label={t.nameLabel} initial={target.name} />
    </ActionDialog>
  );
}
