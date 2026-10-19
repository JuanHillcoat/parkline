"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ROLES } from "../../../src/identity/domain/role";
import { copy } from "../../_lib/copy";
import { ROLE_LABELS } from "../../_lib/messages";
import {
  initialSelection,
  scopeValue,
  withDivision,
  withKind,
  withRole,
  type ScopeKind,
  type ScopeOptions,
  type ScopeSelection,
} from "../../_lib/user-scope";

type Current = { readonly role: string; readonly scopeType: string; readonly scopeId: string } | null;

type Props = {
  readonly idPrefix: string;
  readonly options: ScopeOptions;
  /** The role and scope to preselect; `null` preselects `fallbackRole` over the whole company. */
  readonly current: Current;
  readonly fallbackRole: string;
};

type Update = (change: (state: ScopeSelection) => ScopeSelection) => void;

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
    </div>
  );
}

function RoleSelect({ id, state, update }: { id: string; state: ScopeSelection; update: Update }) {
  const pick = (event: ChangeEvent<HTMLSelectElement>) => { update((s) => withRole(s, event.target.value)); };
  return (
    <Field id={id} label={copy.common.role}>
      <select id={id} name="role" value={state.role} onChange={pick} required className="input">
        {state.role === "" && <option value="" disabled>{copy.common.selectRole}</option>}
        {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
      </select>
    </Field>
  );
}

function KindSelect({ id, state, update }: { id: string; state: ScopeSelection; update: Update }) {
  const pick = (event: ChangeEvent<HTMLSelectElement>) => {
    update((s) => withKind(s, event.target.value as ScopeKind));
  };
  const admin = state.role === "admin";
  return (
    <Field id={id} label={copy.scope.label}>
      <select id={id} value={state.kind} onChange={pick} disabled={admin} required className="input">
        {state.kind === "unresolved" && <option value="unresolved" disabled>{copy.scope.choose}</option>}
        <option value="tenant">{copy.scope.company}</option>
        <option value="business_unit">{copy.scope.division}</option>
        <option value="operation">{copy.scope.operation}</option>
      </select>
      {admin && <span className="hint">{copy.scope.adminHint}</span>}
      {state.kind === "unresolved" && <span className="hint" role="alert">{copy.scope.unavailable}</span>}
    </Field>
  );
}

type PickerProps = { id: string; state: ScopeSelection; update: Update; options: ScopeOptions };

function DivisionSelect({ id, state, update, options }: PickerProps) {
  const pick = (event: ChangeEvent<HTMLSelectElement>) => { update((s) => withDivision(s, event.target.value)); };
  return (
    <Field id={id} label={copy.scope.division}>
      <select id={id} value={state.divisionId} onChange={pick} required className="input">
        <option value="" disabled>{copy.scope.selectDivision}</option>
        {options.divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
    </Field>
  );
}

function OperationSelect({ id, state, update, options }: PickerProps) {
  const pick = (event: ChangeEvent<HTMLSelectElement>) => {
    update((s) => ({ ...s, operationId: event.target.value }));
  };
  const offered = options.operations.filter((o) => o.businessUnitId === state.divisionId);
  return (
    <Field id={id} label={copy.scope.operation}>
      <select id={id} value={state.operationId} onChange={pick} required className="input">
        <option value="" disabled>{copy.scope.selectOperation}</option>
        {offered.map((o) => <option key={o.id} value={o.id}>{`${o.costCenter} ${o.name}`}</option>)}
      </select>
      {state.divisionId !== "" && offered.length === 0 && <span className="hint">{copy.scope.noOperations}</span>}
    </Field>
  );
}

/** The form reset (after a successful submit) puts the selectors back to their initial state. */
function useSelection(initial: ScopeSelection) {
  const anchor = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(initial);
  useEffect(() => {
    const form = anchor.current?.closest("form");
    const reset = () => { setState(initial); };
    form?.addEventListener("reset", reset);
    return () => { form?.removeEventListener("reset", reset); };
  }, [initial]);
  return { anchor, state, update: setState };
}

/**
 * Role, scope level and scope pickers. The validation of the scope stays on the server; this only
 * narrows the operation options by the chosen division. The division of an operation is not submitted.
 */
export function RoleScopeFields({ idPrefix, options, current, fallbackRole }: Props) {
  const [initial] = useState(() =>
    initialSelection(current?.role ?? fallbackRole, current ?? undefined, options));
  const { anchor, state, update } = useSelection(initial);
  const value = scopeValue(state);
  return (
    <div ref={anchor}>
      <RoleSelect id={`${idPrefix}-role`} state={state} update={update} />
      <KindSelect id={`${idPrefix}-scope`} state={state} update={update} />
      {state.kind !== "tenant" && <DivisionSelect id={`${idPrefix}-division`} state={state} update={update} options={options} />}
      {state.kind === "operation" && <OperationSelect id={`${idPrefix}-operation`} state={state} update={update} options={options} />}
      <input type="hidden" name="scopeType" value={value.type} />
      <input type="hidden" name="scopeId" value={value.id} />
    </div>
  );
}
