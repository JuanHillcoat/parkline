import { copy } from "../_lib/copy";
import type { Distribution, Slice } from "../_lib/dashboard-view";

const t = copy.home.distribution;

function Row({ slice }: { slice: Slice }) {
  const barClass = slice.isOther ? "dist-bar dist-bar-other" : "dist-bar";
  return (
    <li className="dist-row">
      <div className="dist-text">
        <span className="dist-label">{slice.label}</span>
        <span className="dist-value">{slice.count} <span className="dist-percent">({slice.percent} %)</span></span>
      </div>
      <progress className={barClass} value={slice.percent} max={100} aria-label={t.row(slice.label, slice.count, slice.percent)} />
    </li>
  );
}

function EmptyDistribution() {
  return (
    <div className="dist-empty" role="status">
      <p className="dist-empty-title">{t.emptyTitle}</p>
      <p>{t.emptyText}</p>
      <a className="btn" href="/fleet">{t.emptyCta}</a>
    </div>
  );
}

/** Horizontal bars in plain CSS; every bar carries its count and percentage as text. */
export function DistributionCard({ id, title, data }: { id: string; title: string; data: Distribution }) {
  return (
    <section className="card dist-card" aria-labelledby={id}>
      <div className="dist-head">
        <h2 id={id}>{title}</h2>
        {data.total > 0 && <span className="dist-total">{t.total(data.total)}</span>}
      </div>
      {data.total === 0 ? <EmptyDistribution /> : <ul className="dist-list">{data.slices.map((s) => <Row key={s.label} slice={s} />)}</ul>}
    </section>
  );
}
