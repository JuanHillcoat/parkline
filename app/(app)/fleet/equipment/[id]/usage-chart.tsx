import { copy } from "../../../../_lib/copy";
import { CHART, type UsageChart } from "../../../../_lib/usage-chart-view";
import type { PeriodOption } from "../../../../_lib/usage-period";
import { PeriodSelect } from "./period-select";

const t = copy.fleet.detail.usage;

type Filter = { readonly options: readonly PeriodOption[]; readonly value: string; readonly tab: string | null };

function Header({ filter }: { filter: Filter }) {
  return (
    <div className="card-head">
      <h2 id="detail-usage-title">{t.title}</h2>
      <PeriodSelect options={filter.options} value={filter.value} tab={filter.tab} />
    </div>
  );
}

function Grid({ chart }: { chart: UsageChart }) {
  return (
    <>
      {chart.ticks.map((tick) => (
        <g key={tick.value}>
          <line className="chart-grid" x1={CHART.left} x2={CHART.right} y1={tick.y} y2={tick.y} />
          <text className="chart-tick" x={CHART.left - 8} y={tick.y + 4} textAnchor="end">{tick.value}</text>
        </g>
      ))}
      {t.months.map((month, index) => (
        <text key={month} className="chart-tick" x={CHART.left + (index * (CHART.right - CHART.left)) / (t.months.length - 1)} y={CHART.bottom + 22} textAnchor="middle">{month}</text>
      ))}
    </>
  );
}

function Plot({ chart }: { chart: UsageChart }) {
  return (
    <>
      {chart.referenceY !== null && <line className="chart-reference" data-testid="chart-reference" x1={CHART.left} x2={CHART.right} y1={chart.referenceY} y2={chart.referenceY} />}
      <path className="chart-area" d={chart.area} />
      <path className="chart-line" d={chart.line} />
      {chart.points.map((point, index) => <circle key={t.months[index]} className="chart-point" cx={point.x} cy={point.y} r={3.5} />)}
    </>
  );
}

function Legend({ unit, reference }: { unit: "hours" | "km"; reference: boolean }) {
  return (
    <ul className="chart-legend">
      <li><span className="chart-legend-square" aria-hidden="true" />{t.legend[unit]}</li>
      {reference && <li><span className="chart-legend-dash" aria-hidden="true" />{t.contracted}</li>}
    </ul>
  );
}

type Props = {
  readonly chart: UsageChart;
  readonly unit: "hours" | "km";
  readonly year: number;
  /** The months drawn already formatted with their unit, January first (the later months are not drawn). */
  readonly values: readonly string[];
  readonly filter: Filter;
};

/** Issue 60 D4 / S8: the usage of the months of the chosen year as an SVG line. The values also exist as a hidden table. */
export function UsageCard({ chart, unit, year, values, filter }: Props) {
  return (
    <section className="card detail-card usage-card" aria-labelledby="detail-usage-title">
      <Header filter={filter} />
      <Legend unit={unit} reference={chart.referenceY !== null} />
      <svg className="chart" viewBox={`0 0 ${String(CHART.width)} ${String(CHART.height)}`} role="img" aria-label={t.label(t.legend[unit], year)}>
        <Grid chart={chart} />
        <Plot chart={chart} />
      </svg>
      <table className="visually-hidden">
        <caption>{t.valuesCaption}</caption>
        <tbody>
          {values.map((value, index) => <tr key={t.months[index]}><th scope="row">{t.months[index]}</th><td>{value}</td></tr>)}
        </tbody>
      </table>
    </section>
  );
}

/** Shown in place of the chart when the asset type has no meter. */
export function UsageCardEmpty({ filter }: { filter: Filter }) {
  return (
    <section className="card detail-card usage-card" aria-labelledby="detail-usage-title">
      <Header filter={filter} />
      <p className="location-none">{t.noMeter}</p>
    </section>
  );
}
