import { ActionDialog } from "../../_components/action-dialog";
import { ReasonField, SelectField, TextField, type Option } from "../../_components/form-fields";
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
      <TextField id={`${idPrefix}-brand`} name="brand" label={t.brandLabel} initial={initial.brand} />
      <TextField id={`${idPrefix}-model`} name="model" label={t.modelLabel} initial={initial.model} />
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

export function NewEquipmentDialog({ options }: { options: EquipmentOptions }) {
  const t = copy.dialogs.newEquipment;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title}
      description={t.description} submitLabel={t.submit} action={createEquipmentAction}>
      <EquipmentFields idPrefix="new-equipment" options={options} initial={EMPTY} />
    </ActionDialog>
  );
}

/** Edits every field of an equipment. The reason is mandatory and the change is audited (ADR-0007). */
export function EditEquipmentDialog({ target, options }: { target: EquipmentRow; options: EquipmentOptions }) {
  const t = copy.dialogs.editEquipment;
  const key = `edit-equipment-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(target.internalCode)}
      description={t.description} submitLabel={t.submit} action={updateEquipmentAction}>
      <input type="hidden" name="id" value={target.id} />
      <EquipmentFields idPrefix={key} options={options} initial={target.form} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
