import { copy } from "../../../../_lib/copy";
import type { InfoRow, LocationView } from "../../../../_lib/equipment-detail-view";

const t = copy.fleet.detail;

function DetailList({ rows }: { rows: readonly InfoRow[] }) {
  return (
    <dl className="detail-list">
      {rows.map((row) => (
        <div key={row.label} className="detail-row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The photo is a neutral placeholder: the real image is a later issue (#44). */
function PhotoPlaceholder() {
  return (
    <div className="photo-placeholder" role="img" aria-label={t.info.photoLabel}>
      <span>{t.info.photoPending}</span>
    </div>
  );
}

export function InfoCard({ rows }: { rows: readonly InfoRow[] }) {
  return (
    <section className="card detail-card" aria-labelledby="detail-info-title">
      <h2 id="detail-info-title">{t.info.title}</h2>
      <div className="detail-card-body">
        <DetailList rows={rows} />
        <PhotoPlaceholder />
      </div>
    </section>
  );
}

export function LocationCard({ view }: { view: LocationView }) {
  return (
    <section className="card detail-card" aria-labelledby="detail-location-title">
      <h2 id="detail-location-title">{t.location.title}</h2>
      {view.assigned ? <DetailList rows={view.rows} /> : (
        <>
          <p className="location-none">{t.location.none}</p>
          <p className="hint">{view.hint}</p>
        </>
      )}
    </section>
  );
}

/** Hours and maintenance are not built yet: a short card, no dead controls. */
export function MoreCard() {
  return (
    <section className="card detail-card" aria-labelledby="detail-more-title">
      <h2 id="detail-more-title">{t.moreTitle}</h2>
      <p>{t.moreText}</p>
    </section>
  );
}
