"use client";

import { useEffect, useRef, useState } from "react";
import type { Option } from "../../_components/form-fields";
import { copy } from "../../_lib/copy";
import { batteryKindOptions, showsBatteryQuantity } from "../../_lib/equipment-fields-view";

type Props = { readonly idPrefix: string; readonly initialKind: string; readonly initialQuantity: string };

/** Tracks the chosen battery kind and goes back to the initial one when the form is reset. */
function useBatteryKind(initialKind: string) {
  const select = useRef<HTMLSelectElement>(null);
  const [kind, setKind] = useState(initialKind);
  useEffect(() => {
    const form = select.current?.form;
    const reset = () => { setKind(initialKind); };
    form?.addEventListener("reset", reset);
    return () => { form?.removeEventListener("reset", reset); };
  }, [initialKind]);
  return { select, kind, setKind };
}

const KINDS: readonly Option[] = batteryKindOptions();

type QuantityProps = { readonly id: string; readonly initial: string };

function QuantityField({ id, initial }: QuantityProps) {
  const t = copy.dialogs.equipmentFields;
  return (
    <div className="field">
      <label htmlFor={id}>{t.batteryQuantityLabel}</label>
      <input id={id} name="batteryQuantity" type="number" min={0} max={4} inputMode="numeric"
        defaultValue={initial} placeholder={t.batteryQuantityPlaceholder} className="input" autoComplete="off" />
    </div>
  );
}

/**
 * The kind of battery and, only for lead acid, how many there are. The quantity input is not rendered for
 * lithium or combustion, so a stale value is never submitted; the server refuses a quantity for them anyway.
 */
export function BatteryFields({ idPrefix, initialKind, initialQuantity }: Props) {
  const t = copy.dialogs.equipmentFields;
  const { select, kind, setKind } = useBatteryKind(initialKind);
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-battery-kind`}>{t.batteryKindLabel}</label>
        <select ref={select} id={`${idPrefix}-battery-kind`} name="batteryKind" required defaultValue={initialKind}
          onChange={(event) => { setKind(event.target.value); }} className="input">
          <option value="" disabled>{t.selectBatteryKind}</option>
          {KINDS.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </div>
      {showsBatteryQuantity(kind) && <QuantityField id={`${idPrefix}-batteries`} initial={initialQuantity} />}
    </>
  );
}
