import { copy } from "../_lib/copy";

export type Option = { readonly id: string; readonly name: string };

type TextProps = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly hint?: string;
  readonly placeholder?: string;
  readonly initial?: string;
  readonly required?: boolean;
  readonly mono?: boolean;
  readonly numeric?: { readonly min: number; readonly max: number };
};

/** A single-line input. A numeric field is still sent as text; the server parses it. */
export function TextField(props: TextProps) {
  const className = props.mono === true ? "input cell-code" : "input";
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} name={props.name} required={props.required ?? false} defaultValue={props.initial}
        placeholder={props.placeholder} className={className} autoComplete="off"
        type={props.numeric === undefined ? "text" : "number"} min={props.numeric?.min} max={props.numeric?.max}
        inputMode={props.numeric === undefined ? undefined : "numeric"} />
      {props.hint !== undefined && <span className="hint">{props.hint}</span>}
    </div>
  );
}

export function NameField(props: { id: string; label: string; hint: string; placeholder?: string; initial?: string }) {
  return <TextField {...props} name="name" required />;
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

export function SelectField(props: SelectProps) {
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

type ReasonProps = {
  readonly id: string;
  readonly placeholder: string;
  /** An optional reason (only some actions need one); the label and the hint then say so. */
  readonly optional?: { readonly label: string; readonly hint: string };
};

export function ReasonField({ id, placeholder, optional }: ReasonProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{optional?.label ?? copy.common.reason}</label>
      <textarea id={id} name="reason" required={optional === undefined} rows={3} placeholder={placeholder}
        className="input" />
      <span className="hint">{optional?.hint ?? copy.common.reasonHint}</span>
    </div>
  );
}

type DateProps = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  /** The day as `YYYY-MM-DD`, or blank. */
  readonly initial?: string;
  readonly required?: boolean;
  readonly hint?: string;
};

/** A calendar day. The browser sends `YYYY-MM-DD`; the server parses it as text, never as a Date. */
export function DateField(props: DateProps) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <input id={props.id} name={props.name} type="date" required={props.required ?? false}
        defaultValue={props.initial ?? ""} className="input" />
      {props.hint !== undefined && <span className="hint">{props.hint}</span>}
    </div>
  );
}

type RadioProps = {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  /** The value checked first; the group is required, so the choice is always sent. */
  readonly initial: string;
};

export function RadioGroupField({ name, legend, options, initial }: RadioProps) {
  return (
    <fieldset className="field choice-group">
      <legend>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="choice">
          <input type="radio" name={name} value={option.value} required defaultChecked={option.value === initial} />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
