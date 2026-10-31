/**
 * The contracted hours drawn as a dashed reference line. TEMPORARY: contracts do not exist yet, so the maintainer
 * asked for 250 for every equipment until they do (issue 60, L5). Remove it, and the `reference` argument, when a
 * contract can say the real figure.
 */
export const REFERENCE_CONTRACTED_HOURS = 250;

/** The drawing area inside the SVG viewBox: room on the left for the values and below for the month names. */
export const CHART = { width: 1000, height: 240, left: 40, right: 984, top: 12, bottom: 206 } as const;

export type ChartPoint = { readonly x: number; readonly y: number; readonly value: number };
export type ChartTick = { readonly value: number; readonly y: number };

export type UsageChart = {
  readonly max: number;
  readonly ticks: readonly ChartTick[];
  readonly points: readonly ChartPoint[];
  readonly line: string;
  readonly area: string;
  /** The y of the reference line, or null when there is none. */
  readonly referenceY: number | null;
};

const MONTHS = 12;
const BASE_TOP = 300;
const BASE_STEP = 100;
const MAX_INTERVALS = 5;

type Scale = { readonly step: number; readonly top: number };

/** 0, 100, 200, 300 while the values fit; above that the next multiple of 100, with a wider step if it would crowd. */
const scaleFor = (highest: number): Scale => {
  if (highest <= BASE_TOP) return { step: BASE_STEP, top: BASE_TOP };
  const intervals = Math.ceil(highest / BASE_STEP);
  const step = BASE_STEP * Math.ceil(intervals / MAX_INTERVALS);
  return { step, top: step * Math.ceil(highest / step) };
};

const round = (value: number): number => Math.round(value * 100) / 100;

const yOf = (value: number, top: number): number => round(CHART.bottom - (value / top) * (CHART.bottom - CHART.top));

const xOf = (index: number): number => round(CHART.left + (index * (CHART.right - CHART.left)) / (MONTHS - 1));

const pointsOf = (totals: readonly number[], top: number): ChartPoint[] =>
  totals.map((total, index) => {
    const value = Math.max(0, total);
    return { x: xOf(index), y: yOf(value, top), value };
  });

const ticksOf = ({ step, top }: Scale): ChartTick[] =>
  Array.from({ length: top / step + 1 }, (_, index) => ({ value: index * step, y: yOf(index * step, top) }));

const segments = (points: readonly ChartPoint[]): string[] => points.map((point) => `L${String(point.x)},${String(point.y)}`);

/** The line starts with a move to the first point; the area is the line closed on the baseline under the last one. */
const shapesOf = (points: readonly ChartPoint[]): { line: string; area: string } => {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return { line: "", area: "" };
  const line = `M${String(first.x)},${String(first.y)} ${segments(points.slice(1)).join(" ")}`.trim();
  const closing = `L${String(last.x)},${String(CHART.bottom)} L${String(first.x)},${String(CHART.bottom)} Z`;
  return { line, area: `M${String(first.x)},${String(CHART.bottom)} ${segments(points).join(" ")} ${closing}` };
};

/**
 * Issue 60 D4 / S8: the scale and the shapes of the usage chart. `totals` are the months drawn, January first; the
 * axis always has twelve slots, so a partial year stops where the data does. A negative total is drawn as zero.
 */
export const buildUsageChart = (totals: readonly number[], reference: number | null): UsageChart => {
  const scale = scaleFor(Math.max(0, ...totals, reference ?? 0));
  const points = pointsOf(totals, scale.top);
  return {
    max: scale.top,
    ticks: ticksOf(scale),
    points,
    ...shapesOf(points),
    referenceY: reference === null ? null : yOf(reference, scale.top),
  };
};
