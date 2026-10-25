import { ActionDialog } from "../../../../_components/action-dialog";
import { DateField, ReasonField } from "../../../../_components/form-fields";
import { copy } from "../../../../_lib/copy";
import { correctReadingAction, recordReadingAction, replaceMeterAction } from "./reading-actions";

type ValueProps = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hint: string;
  readonly initial?: string;
};

/**
 * A meter value. It is text (not a number input) so a comma or a second decimal reaches the server, which
 * answers with its typed message; the browser would otherwise block the submit with its own English text.
 */
function ValueField({ id, name, label, hint, initial }: ValueProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={name} type="text" inputMode="decimal" defaultValue={initial} className="input" autoComplete="off" />
      <span className="hint">{hint}</span>
    </div>
  );
}

type Target = { readonly id: string; readonly code: string };
type LoadProps = { readonly target: Target; readonly today: string };

/** Loads a new reading: the day defaults to today, the reason is optional. */
export function RecordReadingDialog({ target, today }: LoadProps) {
  const t = copy.dialogs.recordReading;
  const key = `reading-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-primary" title={t.title(target.code)}
      description={t.description} submitLabel={t.submit} action={recordReadingAction}>
      <input type="hidden" name="equipmentId" value={target.id} />
      <DateField id={`${key}-day`} name="day" label={t.dayLabel} initial={today} required />
      <ValueField id={`${key}-value`} name="value" label={t.valueLabel} hint={t.valueHint} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} optional={{ label: t.reasonLabel, hint: t.reasonHint }} />
    </ActionDialog>
  );
}

type CorrectProps = {
  readonly equipmentId: string;
  readonly readingId: string;
  /** The day as shown (DD/MM/YYYY), for the title. */
  readonly day: string;
  /** The current value, prefilled. */
  readonly value: string;
};

/** Corrects one reading; the original stays in the history and the reason is mandatory. */
export function CorrectReadingDialog({ equipmentId, readingId, day, value }: CorrectProps) {
  const t = copy.dialogs.correctReading;
  const key = `correct-reading-${readingId}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn btn-link" title={t.title(day)}
      description={t.description} submitLabel={t.submit} action={correctReadingAction}>
      <input type="hidden" name="equipmentId" value={equipmentId} />
      <input type="hidden" name="readingId" value={readingId} />
      <ValueField id={`${key}-value`} name="value" label={t.valueLabel} hint={t.valueHint} initial={value} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}

/** Closes the open meter with its final reading and opens a new one; the reason is mandatory. */
export function ReplaceMeterDialog({ target, today }: LoadProps) {
  const t = copy.dialogs.replaceMeter;
  const key = `replace-meter-${target.id}`;
  return (
    <ActionDialog triggerLabel={t.trigger} triggerClassName="btn" title={t.title(target.code)}
      description={t.description} submitLabel={t.submit} action={replaceMeterAction}>
      <input type="hidden" name="equipmentId" value={target.id} />
      <DateField id={`${key}-day`} name="day" label={t.dayLabel} initial={today} required />
      <ValueField id={`${key}-final`} name="finalValue" label={t.finalLabel} hint={t.valueHint} />
      <ValueField id={`${key}-initial`} name="initialValue" label={t.initialLabel} hint={t.valueHint} />
      <ReasonField id={`${key}-reason`} placeholder={t.reasonPlaceholder} />
    </ActionDialog>
  );
}
