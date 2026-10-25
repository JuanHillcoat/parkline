"use client";

import { useEffect, useState } from "react";
import { copy } from "../../_lib/copy";

type Kind = "hours" | "km" | "none";

type Props = {
  /** The id of the asset type select of the same form. */
  readonly selectId: string;
  /** The meter kind of each asset type id. */
  readonly meters: Readonly<Record<string, Kind>>;
  readonly today: string;
};

/** Follows the asset type chosen in the form: the group exists only while it has a meter of hours or km. */
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
 * The optional first reading of a new equipment (issue 52, D11). Nothing is sent unless a value is typed. It is
 * not rendered for an asset type without a meter, so its inputs are not submitted either; the server refuses
 * a reading for such a type anyway.
 */
export function InitialReadingFields({ selectId, meters, today }: Props) {
  const kind = useChosenKind(selectId, meters);
  const t = copy.dialogs.newEquipment;
  if (kind === "none") return null;
  return (
    <fieldset className="field choice-group">
      <legend>{t.readingLegend}</legend>
      <span className="hint">{t.readingHint}</span>
      <div className="field">
        <label htmlFor="new-equipment-reading-value">{`${t.readingValueLabel} (${copy.fleet.detail.readings.units[kind]})`}</label>
        <input id="new-equipment-reading-value" name="readingValue" type="text" inputMode="decimal" className="input" autoComplete="off" />
        <span className="hint">{t.readingValueHint}</span>
      </div>
      <div className="field">
        <label htmlFor="new-equipment-reading-day">{t.readingDayLabel}</label>
        <input id="new-equipment-reading-day" name="readingDay" type="date" defaultValue={today} className="input" />
      </div>
    </fieldset>
  );
}
