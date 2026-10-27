"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
  type ReactNode,
} from "react";
import { copy } from "../_lib/copy";
import { IDLE, type ActionState } from "../_lib/action-state";

export type DialogAction = (previous: ActionState, form: FormData) => Promise<ActionState>;

type Props = {
  readonly triggerLabel: string;
  readonly triggerClassName: string;
  readonly title: string;
  readonly description: string;
  readonly submitLabel: string;
  readonly danger?: boolean;
  /** A wide dialog for a long form: its fields sit in a multi-column grid (one column on a phone). */
  readonly wide?: boolean;
  readonly action: DialogAction;
  readonly children: ReactNode;
};

/**
 * Submits through `onSubmit` instead of the `action` prop so React does not
 * reset the fields after a failed attempt. A success closes and resets.
 */
function useDialogForm(action: DialogAction) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const [dismissed, setDismissed] = useState<ActionState>(IDLE);
  useEffect(() => {
    if (state.status !== "success") return;
    form.current?.reset();
    dialog.current?.close();
  }, [state]);
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => {
      dispatch(data);
    });
  };
  const message = state.status === "error" && state !== dismissed ? state.message : null;
  return { dialog, form, pending, message, submit, dismiss: () => { setDismissed(state); } };
}

type FooterProps = {
  readonly submitLabel: string;
  readonly danger: boolean;
  readonly pending: boolean;
  readonly message: string | null;
  readonly onCancel: () => void;
};

function DialogFooter({ submitLabel, danger, pending, message, onCancel }: FooterProps) {
  return (
    <>
      {message !== null && <p role="alert" className="form-error">{message}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>{copy.common.cancel}</button>
        <button type="submit" disabled={pending} className={danger ? "btn btn-danger" : "btn btn-primary"}>
          {submitLabel}
        </button>
      </div>
    </>
  );
}

export function ActionDialog(props: Props) {
  const titleId = useId();
  const ui = useDialogForm(props.action);
  const close = () => { ui.dialog.current?.close(); };
  const open = () => { ui.dialog.current?.showModal(); };
  return (
    <>
      <button type="button" className={props.triggerClassName} onClick={open}>{props.triggerLabel}</button>
      <dialog ref={ui.dialog} className={props.wide === true ? "dialog dialog-wide" : "dialog"} aria-labelledby={titleId} onClose={ui.dismiss}>
        <form ref={ui.form} onSubmit={ui.submit}>
          <h2 id={titleId}>{props.title}</h2>
          <p className="dialog-sub">{props.description}</p>
          {props.children}
          <DialogFooter submitLabel={props.submitLabel} danger={props.danger === true}
            pending={ui.pending} message={ui.message} onCancel={close} />
        </form>
      </dialog>
    </>
  );
}
