"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "../_lib/copy";
import {
  isMuleto,
  MULETO,
  NO_PLACEMENT,
  offersMuleto,
  operationOfChoice,
  placementChoice,
  type PlacementValues,
} from "../_lib/equipment-fields-view";
import type { Option } from "./form-fields";

type Props = {
  readonly idPrefix: string;
  /** The label and the empty prompt of the operation select, which every dialog words its own way. */
  readonly label: string;
  readonly prompt: string;
  readonly operations: readonly Option[];
  /** Every active site the actor may write at: the Site select (and the Muleto choice) exist only when there is one. */
  readonly sites: readonly Option[];
  readonly initial?: PlacementValues;
  /** An optional place may stay empty: the first option is a choosable "none" instead of a disabled prompt. */
  readonly optional?: boolean;
};

/** Tracks the chosen place and goes back to the initial one when the form is reset (a success resets it). */
function usePlacementChoice(initial: PlacementValues) {
  const select = useRef<HTMLSelectElement>(null);
  const first = placementChoice(initial);
  const [choice, setChoice] = useState(first);
  useEffect(() => {
    const form = select.current?.form;
    const reset = () => { setChoice(first); };
    form?.addEventListener("reset", reset);
    return () => { form?.removeEventListener("reset", reset); };
  }, [first]);
  return { select, choice, setChoice };
}

type SiteProps = { readonly id: string; readonly sites: readonly Option[]; readonly initial: string };

function SiteSelect({ id, sites, initial }: SiteProps) {
  const t = copy.dialogs.placement;
  return (
    <div className="field">
      <label htmlFor={id}>{t.siteLabel}</label>
      <select id={id} name="siteId" required defaultValue={initial} className="input">
        <option value="" disabled>{t.selectSite}</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
    </div>
  );
}

/**
 * The place of an equipment: an operation, or Muleto (a spare belongs to a SITE, ADR-0013). The visible select
 * has no name; the form carries `operationId` (blank for a muleto) and, only for a muleto, the `siteId` of the
 * Site select that appears.
 */
export function PlacementFields({ idPrefix, label, prompt, operations, sites, initial = NO_PLACEMENT, optional = false }: Props) {
  const { select, choice, setChoice } = usePlacementChoice(initial);
  const muleto = isMuleto(choice);
  return (
    <>
      <div className="field">
        <label htmlFor={`${idPrefix}-operation`}>{label}</label>
        <select ref={select} id={`${idPrefix}-operation`} required={!optional} defaultValue={placementChoice(initial)} className="input"
          onChange={(event) => { setChoice(event.target.value); }}>
          <option value="" disabled={!optional}>{prompt}</option>
          {operations.map((operation) => <option key={operation.id} value={operation.id}>{operation.name}</option>)}
          {offersMuleto(sites) && <option value={MULETO}>{copy.dialogs.placement.muleto}</option>}
        </select>
        <input type="hidden" name="operationId" value={operationOfChoice(choice)} />
      </div>
      {muleto && <SiteSelect id={`${idPrefix}-site`} sites={sites} initial={initial.siteId} />}
    </>
  );
}
