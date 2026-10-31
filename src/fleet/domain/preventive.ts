export type PreventiveState = "ok" | "due_soon" | "overdue";

export type PreventiveStatus = {
  /** The reading at which the next preventive is due: base + interval. */
  readonly next: number;
  /** What the cycle has used since the base, never below 0. */
  readonly consumed: number;
  /** `next - current`; zero or negative once overdue. */
  readonly remaining: number;
  /** The share of the interval consumed, from 0 to 100. */
  readonly percent: number;
  readonly state: PreventiveState;
};

/** The share of the interval above which a preventive is due soon (docs/00-analisis-inicial.md). */
const DUE_SOON_SHARE = 0.75;

const stateOf = (remaining: number, consumed: number, interval: number): PreventiveState => {
  if (remaining <= 0) return "overdue";
  return consumed > interval * DUE_SOON_SHARE ? "due_soon" : "ok";
};

/**
 * Issue 60 D3: where an equipment stands in its preventive cycle. `interval` is a positive number in the
 * meter's unit, `base` the reading the cycle started at and `current` the latest reading.
 */
export const preventiveStatus = (interval: number, base: number, current: number): PreventiveStatus => {
  const next = base + interval;
  const consumed = Math.max(0, current - base);
  const remaining = next - current;
  return { next, consumed, remaining, percent: Math.min(100, (consumed / interval) * 100), state: stateOf(remaining, consumed, interval) };
};
