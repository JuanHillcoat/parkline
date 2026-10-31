"use client";

import { copy } from "../../../../_lib/copy";
import type { PeriodOption } from "../../../../_lib/usage-period";

const t = copy.fleet.detail.usage;

type Props = {
  readonly options: readonly PeriodOption[];
  readonly value: string;
  /** The tab to keep when the form reloads the page (the default tab needs none). */
  readonly tab: string | null;
};

/**
 * The period filter of the usage card: a GET form, so the page re-renders on the server with `?period=YYYY-MM`.
 * Choosing a month submits it; without JavaScript the button inside `noscript` does.
 */
export function PeriodSelect({ options, value, tab }: Props) {
  return (
    <form method="get" className="period-form">
      {tab !== null && <input type="hidden" name="tab" value={tab} />}
      <label htmlFor="usage-period">{t.period}</label>
      <select id="usage-period" name="period" className="input" defaultValue={value} onChange={(event) => { event.currentTarget.form?.requestSubmit(); }}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <noscript><button type="submit" className="btn">{t.periodApply}</button></noscript>
    </form>
  );
}
