import { EditImageField, NewImageField } from "../../_components/image-field";
import { ActionDialog, type DialogAction } from "../../_components/action-dialog";
import { DateField, ReasonField, SelectField, TextField, type Option } from "../../_components/form-fields";
import { copy } from "../../_lib/copy";
import type { EquipmentFormValues, EquipmentRow } from "../../_lib/fleet-view";
import { createEquipmentAction, updateEquipmentAction } from "./actions";

export type EquipmentOptions = { readonly suppliers: readonly Option[]; readonly assetTypes: readonly Option[] };

const EMPTY: EquipmentFormValues = {
  internalCode: "", supplierId: "", assetTypeId: "", brand: "", model: "",
  year: "", serialNumber: "", batteryQuantity: "", observations: "",
};

type FieldsProps = { readonly idPrefix: string; readonly options: EquipmentOptions; readonly initial: EquipmentFormValues };

function IdentityFields({ idPrefix, options, initial }: FieldsProps) {
  const t = copy.dialogs.equipmentFields;
  return (
    <>
      <TextField id={`${idPrefix}-code`} name="internalCode" label={t.internalCodeLabel} hint={t.internalCodeHint}
        placeholder={t.internalCodePlaceholder} initial={initial.internalCode} required mono />
      <SelectField id={`${idPrefix}-supplier`} name="supplierId" label={t.supplierLabel}
        prompt={t.selectSupplier} options={options.suppliers} initial={initial.supplierId} />
      <SelectField id={`${idPrefix}-type`} name="assetTypeId" label={t.assetTypeLabel}
        prompt={t.selectAssetType} options={options.assetTypes} initial={initial.assetTypeId} />
    </>
  );
}

function DetailFields({ idPrefix, initial }: Pick<FieldsProps, "idPrefix" | "initial">) {
  const t = copy.dialogs.equipmentFields;
  return (
    <>
      <TextField id={`${idPrefix}-brand`} name="brand" label={t.brandLabel} initial={initial.brand} required />
      <TextField id={`${idPrefix}-model`} name="model" label={t.modelLabel} initial={initial.model} required />
      <TextField id={`${idPrefix}-year`} name="year" label={t.yearLabel} hint={t.yearHint}
        initial={initial.year} numeric={{ min: 1950, max: new Date().getFullYear() + 1 }} />
      <TextField id={`${idPrefix}-serial`} name="serialNumber" label={t.serialNumberLabel}
        hint={t.serialNumberHint} initial={initial.serialNumber} />
      <TextField id={`${idPrefix}-batteries`} name="batteryQuantity" label={t.batteryQuantityLabel}
        hint={t.batteryQuantityHint} initial={initial.batteryQuantity} numeric={{ min: 0, max: 4 }} />
    </>
  );
}

function ObservationsField({ id, initial }: { id: string; initial: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{copy.dialogs.equipmentFields.observationsLabel}</label>
      <textarea id={id} name="observations" rows={3} maxLength={500} defaultValue={initial} className="input" />
    </div>
  );
}

function EquipmentFields(props: FieldsProps) {
  return (
    <>
      <IdentityFields {...props} />
      <DetailFields idPrefix={props.idPrefix} initial={props.initial} />
      <ObservationsField id={`${props.idPrefix}-observations`} initial={props.initial.observations} />
    </>
  );
}

const KINDS: readonly Option[] = [
  { id: "active", name: copy.fleet.detail.kinds.active },
  { id: "spare", name: copy.fleet.detail.kinds.spare },
];

type AssignmentProps = { readonly operations: readonly Option[]; readonly today: string };

/** The optional first assignment: the server asks for the reason only when the day is in the past. */
function AssignmentFields({ operations, today }: AssignmentProps) {
  const t = copy.dialogs.assignEquipment;
  const n = copy.dialogs.newEquipment;
  return (
    <fieldset className="field choice-group">
      <legend>{n.assignmentLegend}</legend>
      <span className="hint">{n.assignmentHint}</span>
      <SelectField id="new-equipment-operation" name="operationId" label={t.operationLabel} prompt={n.noOperation}
        options={operations} optional />
      <SelectField id="new-equipment-kind" name="kind" label={t.kindLabel} prompt={t.selectKind} options={KINDS} initial="active" />
      <DateField id="new-equipment-day" name="day" label={t.dayLabel} initial={today} />
      <ReasonField id="new-equipment-reason" placeholder={t.reasonPlaceholder} optional={{ label: t.reasonLabel, hint: t.reasonHint }} />
    </fieldset>
  );
}

type NewProps = AssignmentProps & { readonly options: EquipmentOptions };

export function NewEquipmentDialog({ options, operations, today }: NewProps) {
  const t = copy.dialogs.newEquipment;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title}
      description={t.description} submitLabel={t.submit} action={createEquipmentAction}>
      <EquipmentFields idPrefix="new-equipment" options={options} initial={EMPTY} />
      <NewImageField id="new-equipment-image" />
      <AssignmentFields operations={operations} today={today} />
    </ActionDialog>
  );
}

type EditProps = {
  readonly target: EquipmentRow;
  readonly options: EquipmentOptions;
  /** The detail page passes its own button style and an action that revalidates that page. */
  readonly triggerClassName?: string;
  readonly action?: DialogAction;
};

/** Edits every field of an equipment. The reason is mandatory and the change is audited (ADR-0007). */
export function EditEquipmentDialog({ target, options, triggerClassName = "btn btn-link", action = updateEquipmentAction }: EditProps) {
  const t = copy.dialogs.editEquipment;
  const key = `edit-equipment-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName={triggerClassName} title={t.title(target.internalCode)}
      description={t.description} submitLabel={t.submit} action={action}>
      <input type="hidden" name="id" value={target.id} />
      <EquipmentFields idPrefix={key} options={options} initial={target.form} />
      <EditImageField id={`${key}-image`} currentUrl={target.imageUrl} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
