import { ActionDialog } from "../../../../_components/action-dialog";
import { DateField, RadioGroupField, ReasonField, SelectField, type Option } from "../../../../_components/form-fields";
import { copy } from "../../../../_lib/copy";
import { OUTGOING_DEFAULT, outgoingChoices, type CorrectionValues } from "../../../../_lib/equipment-detail-view";
import {
  assignEquipmentAction,
  correctAssignmentAction,
  endAssignmentAction,
  moveEquipmentAction,
  replaceEquipmentAction,
} from "./actions";

const KINDS: readonly Option[] = [
  { id: "active", name: copy.fleet.detail.kinds.active },
  { id: "spare", name: copy.fleet.detail.kinds.spare },
];

type Target = { readonly id: string; readonly code: string };
type DayProps = { readonly target: Target; readonly today: string };
type OperationProps = DayProps & { readonly operations: readonly Option[] };

/** The first assignment: the reason is optional here, the server asks for it only when the day is in the past. */
export function AssignDialog({ target, today, operations }: OperationProps) {
  const t = copy.dialogs.assignEquipment;
  const key = `assign-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title(target.code)}
      description={t.description} submitLabel={t.submit} action={assignEquipmentAction}>
      <input type="hidden" name="equipmentId" value={target.id} />
      <SelectField id={`${key}-operation`} name="operationId" label={t.operationLabel} prompt={t.selectOperation} options={operations} />
      <SelectField id={`${key}-kind`} name="kind" label={t.kindLabel} prompt={t.selectKind} options={KINDS} initial="active" />
      <DateField id={`${key}-day`} name="day" label={t.dayLabel} initial={today} required />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} optional={{ label: t.reasonLabel, hint: t.reasonHint }} />
    </ActionDialog>
  );
}

/** Moves the equipment to another operation; the operations offered exclude the current one. */
export function MoveDialog({ target, today, operations }: OperationProps) {
  const t = copy.dialogs.moveEquipment;
  const key = `move-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title(target.code)}
      description={t.description} submitLabel={t.submit} action={moveEquipmentAction}>
      <input type="hidden" name="equipmentId" value={target.id} />
      <SelectField id={`${key}-operation`} name="operationId" label={t.operationLabel} prompt={t.selectOperation} options={operations} />
      <DateField id={`${key}-day`} name="day" label={t.dayLabel} initial={today} required />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

type ReplaceProps = DayProps & { readonly candidates: readonly Option[]; readonly canArchive: boolean };

/** Opened from the OUTGOING equipment (D5): the choice of what happens to it is required and never skipped. */
export function ReplaceDialog({ target, today, candidates, canArchive }: ReplaceProps) {
  const t = copy.dialogs.replaceEquipment;
  const key = `replace-${target.id}`;
  const labels = { spare: t.outgoingSpare, retire: t.outgoingRetire };
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title(target.code)}
      description={t.description} submitLabel={t.submit} action={replaceEquipmentAction}>
      <input type="hidden" name="equipmentId" value={target.id} />
      <SelectField id={`${key}-incoming`} name="incomingEquipmentId" label={t.incomingLabel} prompt={t.selectIncoming}
        options={candidates} hint={candidates.length === 0 ? t.incomingNone : t.incomingHint} />
      <DateField id={`${key}-day`} name="day" label={t.dayLabel} initial={today} required />
      <RadioGroupField name="outgoing" legend={t.outgoingLegend} initial={OUTGOING_DEFAULT}
        options={outgoingChoices(canArchive).map((value) => ({ value, label: labels[value] }))} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

export function EndDialog({ target, today }: DayProps) {
  const t = copy.dialogs.endAssignment;
  const key = `end-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title(target.code)}
      description={t.description} submitLabel={t.submit} action={endAssignmentAction}>
      <input type="hidden" name="equipmentId" value={target.id} />
      <DateField id={`${key}-day`} name="day" label={t.dayLabel} initial={today} required />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

type CorrectProps = {
  readonly equipmentId: string;
  readonly assignmentId: string;
  readonly values: CorrectionValues;
  readonly operations: readonly Option[];
};

/** Corrects a row of the history, prefilled with its current values. An empty end opens it again. */
export function CorrectDialog({ equipmentId, assignmentId, values, operations }: CorrectProps) {
  const t = copy.dialogs.correctAssignment;
  const key = `correct-${assignmentId}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title}
      description={t.description} submitLabel={t.submit} action={correctAssignmentAction}>
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <DateField id={`${key}-from`} name="validFrom" label={t.fromLabel} initial={values.validFrom} required />
      <DateField id={`${key}-to`} name="validTo" label={t.toLabel} initial={values.validTo} hint={t.toHint} />
      <SelectField id={`${key}-operation`} name="operationId" label={t.operationLabel} prompt={t.selectOperation}
        options={operations} initial={values.operationId} />
      <SelectField id={`${key}-kind`} name="kind" label={t.kindLabel} prompt={t.selectKind} options={KINDS} initial={values.kind} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
