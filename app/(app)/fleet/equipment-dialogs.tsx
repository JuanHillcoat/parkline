import { EditImageField, NewImageField } from "../../_components/image-field";
import { ActionDialog, type DialogAction } from "../../_components/action-dialog";
import { DateField, ReasonField, SelectField, TextField, type Option } from "../../_components/form-fields";
import { PlacementFields } from "../../_components/placement-fields";
import { copy } from "../../_lib/copy";
import type { AssetTypeOption, EquipmentFormValues, EquipmentRow } from "../../_lib/fleet-view";
import { BatteryFields } from "./battery-fields";
import { createEquipmentAction, updateEquipmentAction } from "./actions";
import { InitialReadingFields } from "./initial-reading-fields";

export type EquipmentOptions = { readonly suppliers: readonly Option[]; readonly assetTypes: readonly AssetTypeOption[] };

const EMPTY: EquipmentFormValues = {
  internalCode: "", supplierId: "", assetTypeId: "", brand: "", model: "",
  year: "", serialNumber: "", batteryKind: "", batteryQuantity: "", observations: "",
};

type FieldsProps = { readonly idPrefix: string; readonly options: EquipmentOptions; readonly initial: EquipmentFormValues };

/** Interno, Tipo de equipo, Marca, Modelo, Serie and Año, in the order of the registration. */
function IdentityFields({ idPrefix, options, initial }: FieldsProps) {
  const t = copy.dialogs.equipmentFields;
  return (
    <>
      <TextField id={`${idPrefix}-code`} name="internalCode" label={t.internalCodeLabel}
        placeholder={t.internalCodePlaceholder} initial={initial.internalCode} required mono />
      <SelectField id={`${idPrefix}-type`} name="assetTypeId" label={t.assetTypeLabel}
        prompt={t.selectAssetType} options={options.assetTypes} initial={initial.assetTypeId} />
      <TextField id={`${idPrefix}-brand`} name="brand" label={t.brandLabel} initial={initial.brand} required />
      <TextField id={`${idPrefix}-model`} name="model" label={t.modelLabel} initial={initial.model} required />
      <TextField id={`${idPrefix}-serial`} name="serialNumber" label={t.serialNumberLabel}
        placeholder={t.serialNumberPlaceholder} initial={initial.serialNumber} />
      <TextField id={`${idPrefix}-year`} name="year" label={t.yearLabel} placeholder={t.yearPlaceholder}
        initial={initial.year} numeric={{ min: 1950, max: new Date().getFullYear() + 1 }} />
    </>
  );
}

/** The battery, then the supplier: what follows the meter in the registration. */
function BatteryAndSupplierFields({ idPrefix, options, initial }: FieldsProps) {
  const t = copy.dialogs.equipmentFields;
  return (
    <>
      <BatteryFields idPrefix={idPrefix} initialKind={initial.batteryKind} initialQuantity={initial.batteryQuantity} />
      <SelectField id={`${idPrefix}-supplier`} name="supplierId" label={t.supplierLabel}
        prompt={t.selectSupplier} options={options.suppliers} initial={initial.supplierId} />
    </>
  );
}

function ObservationsField({ id, initial }: { id: string; initial: string }) {
  return (
    <div className="field field-span-full">
      <label htmlFor={id}>{copy.dialogs.equipmentFields.observationsLabel}</label>
      <textarea id={id} name="observations" rows={2} maxLength={500} defaultValue={initial} className="input" />
    </div>
  );
}

type NewProps = {
  readonly options: EquipmentOptions;
  readonly operations: readonly Option[];
  readonly sites: readonly Option[];
  readonly today: string;
};

const metersOf = (options: EquipmentOptions): Record<string, AssetTypeOption["meterKind"]> =>
  Object.fromEntries(options.assetTypes.map((type) => [type.id, type.meterKind]));

/**
 * The registration on one screen (issue 54, D6): identity, Horómetro (only for a type with a meter, right after
 * Año), battery, supplier, Operación (or Muleto with its Site), "Fecha de ingreso" (the day of the
 * assignment and of the first reading), the image on its own row (so it never moves as fields appear) and Observaciones last, which is also the reason of the assignment.
 */
export function NewEquipmentDialog({ options, operations, sites, today }: NewProps) {
  const t = copy.dialogs.newEquipment;
  const id = "new-equipment";
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title} wide
      description={t.description} submitLabel={t.submit} action={createEquipmentAction}>
      <div className="form-grid">
        <IdentityFields idPrefix={id} options={options} initial={EMPTY} />
        <InitialReadingFields selectId={`${id}-type`} meters={metersOf(options)} />
        <BatteryAndSupplierFields idPrefix={id} options={options} initial={EMPTY} />
        <PlacementFields idPrefix={id} label={t.operationLabel} prompt={t.noOperation} operations={operations} sites={sites} optional />
        <DateField id={`${id}-day`} name="day" label={t.dayLabel} initial={today} />
        <NewImageField id={`${id}-image`} />
        <ObservationsField id={`${id}-observations`} initial="" />
      </div>
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
    <ActionDialog triggerLabel={t.trigger} triggerClassName={triggerClassName} title={t.title(target.internalCode)} wide
      description={t.description} submitLabel={t.submit} action={action}>
      <input type="hidden" name="id" value={target.id} />
      <div className="form-grid">
        <IdentityFields idPrefix={key} options={options} initial={target.form} />
        <BatteryAndSupplierFields idPrefix={key} options={options} initial={target.form} />
        <EditImageField id={`${key}-image`} currentUrl={target.imageUrl} />
        <ObservationsField id={`${key}-observations`} initial={target.form.observations} />
        <div className="field-span-2">
          <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
        </div>
      </div>
    </ActionDialog>
  );
}
