import { copy } from "./copy";

const t = copy.fleet.detail.usage;

/** How many months the period filter offers, the current one included. */
export const PERIOD_MONTHS = 24;

export type Period = { readonly year: number; readonly month: number };
export type PeriodOption = { readonly value: string; readonly label: string };

type Raw = string | readonly string[] | undefined;

const pad = (value: number): string => String(value).padStart(2, "0");

/** `YYYY-MM`, the value of the `period` query parameter. */
export const periodValue = ({ year, month }: Period): string => `${String(year)}-${pad(month)}`;

/** The month that contains `today` (`YYYY-MM-DD`). */
const currentOf = (today: string): Period => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });

/** How many months `period` is before `from` (negative for a later one). */
const monthsBefore = (from: Period, period: Period): number => (from.year - period.year) * 12 + (from.month - period.month);

/**
 * The month the usage card and the cards beside it refer to. A missing, malformed, repeated, future or older-than-
 * the-filter value is the current month, so a URL typed by hand never breaks the page.
 */
export const parsePeriod = (raw: Raw, today: string): Period => {
  const current = currentOf(today);
  const match = typeof raw === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/u.exec(raw) : null;
  if (match === null) return current;
  const period = { year: Number(match[1]), month: Number(match[2]) };
  const back = monthsBefore(current, period);
  return back >= 0 && back < PERIOD_MONTHS ? period : current;
};

/** The choices of the period filter: the last 24 months, the current one first. */
export const periodOptions = (today: string): PeriodOption[] => {
  const current = currentOf(today);
  return Array.from({ length: PERIOD_MONTHS }, (_, back) => {
    const index = current.year * 12 + (current.month - 1) - back;
    const period = { year: Math.floor(index / 12), month: (index % 12) + 1 };
    return { value: periodValue(period), label: t.periodLabel(t.monthNames[period.month - 1] ?? "", period.year) };
  });
};
