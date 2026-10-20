"use client";

import { useEffect, useRef, useState } from "react";
import { METER_KINDS, type MeterKind } from "../../../src/fleet/domain/values";
import { copy } from "../../_lib/copy";

type Props = { readonly idPrefix: string; readonly initialKind: MeterKind; readonly initialInterval: string };

const toKind = (value: string, fallback: MeterKind): MeterKind => METER_KINDS.find((kind) => kind === value) ?? fallback;

/** Tracks the chosen meter kind and goes back to the initial one when the form is reset. */
function useMeterKind(initialKind: MeterKind) {
  const select = useRef<HTMLSelectElement>(null);
  const [kind, setKind] = useState<MeterKind>(initialKind);
  useEffect(() => {
    const form = select.current?.form;
    const reset = () => { setKind(initialKind); };
    form?.addEventListener("reset", reset);
    return () => { form?.removeEventListener("reset", reset); };
  }, [initialKind]);
  return { select, kind, choose: (value: string) => { setKind(toKind(value, initialKind)); } };
}

type IntervalProps = { readonly id: string; readonly disabled: boolean; readonly initial: string };

function IntervalField({ id, disabled, initial }: IntervalProps) {
  const t = copy.dialogs.meterFields;
  return (
    <div className="field">
      <label htmlFor={id}>{t.intervalLabel}</label>
      <input id={id} name="preventiveIntervalHours" type="number" min={1} max={10000}
        inputMode="numeric" disabled={disabled} defaultValue={initial} className="input" autoComplete="off" />
      <span className="hint">{disabled ? t.intervalNone : t.intervalHint}</span>
    </div>
  );
}

/**
 * The meter kind and the preventive interval. Without a meter there is no interval, so the
 * input is disabled (a disabled input is not submitted); the server enforces the rule anyway.
 */
export function MeterFields({ idPrefix, initialKind, initialInterval }: Props) {
  const meter = useMeterKind(initialKind);
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-meter`}>{copy.dialogs.meterFields.meterLabel}</label>
        <select ref={meter.select} id={`${idPrefix}-meter`} name="meterKind" required defaultValue={initialKind}
          onChange={(event) => { meter.choose(event.target.value); }} className="input">
          {METER_KINDS.map((option) => <option key={option} value={option}>{copy.fleet.meter[option]}</option>)}
        </select>
      </div>
      <IntervalField id={`${idPrefix}-interval`} disabled={meter.kind === "none"} initial={initialInterval} />
    </>
  );
}
