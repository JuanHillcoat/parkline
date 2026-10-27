"use client";

import { useEffect, useState } from "react";
import { readingFieldLabel } from "../../_lib/equipment-fields-view";

type Kind = "hours" | "km" | "none";

type Props = {
  /** The id of the equipment type select of the same form. */
  readonly selectId: string;
  /** The meter kind of each equipment type id. */
  readonly meters: Readonly<Record<string, Kind>>;
};

/** Follows the equipment type chosen in the form: the field exists only while it has a meter of hours or km. */
function useChosenKind(selectId: string, meters: Props["meters"]): Kind {
  const [kind, setKind] = useState<Kind>("none");
  useEffect(() => {
    const select = document.getElementById(selectId);
    if (!(select instanceof HTMLSelectElement)) return undefined;
    const sync = () => { setKind(meters[select.value] ?? "none"); };
    const reset = () => { setKind("none"); };
    sync();
    select.addEventListener("change", sync);
    select.form?.addEventListener("reset", reset);
    return () => {
      select.removeEventListener("change", sync);
      select.form?.removeEventListener("reset", reset);
    };
  }, [selectId, meters]);
  return kind;
}

/**
 * The first reading of a new equipment (issue 52, D11), "Horómetro" or "Kilometraje" by the meter of the type.
 * Nothing is sent unless a value is typed; its day is the "Fecha de ingreso" of the registration. It is not rendered
 * for a type without a meter, so its input is not submitted either; the server refuses a reading for such a type anyway.
 */
export function InitialReadingFields({ selectId, meters }: Props) {
  const label = readingFieldLabel(useChosenKind(selectId, meters));
  if (label === null) return null;
  return (
    <div className="field">
      <label htmlFor="new-equipment-reading-value">{label}</label>
      <input id="new-equipment-reading-value" name="readingValue" type="text" inputMode="decimal" className="input" autoComplete="off" />
    </div>
  );
}
