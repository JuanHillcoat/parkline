import type { CSSProperties, ReactNode } from "react";
import { copy } from "../../../../_lib/copy";
import type { InfoRow, LocationView } from "../../../../_lib/equipment-detail-view";
import type { MaintenanceView, Tone } from "../../../../_lib/equipment-maintenance-view";

const t = copy.fleet.detail;

function DetailList({ rows, className = "detail-list" }: { rows: readonly InfoRow[]; className?: string }) {
  return (
    <dl className={className}>
      {rows.map((row) => (
        <div key={row.label} className="detail-row">
          <dt>{row.label}</dt>
          <dd title={row.value}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The photo of the equipment, or a neutral placeholder without one. The frame has a fixed aspect, so nothing shifts. */
function Photo({ url }: { readonly url: string | null }) {
  if (url === null) {
    return (
      <div className="photo-placeholder" role="img" aria-label={t.info.photoLabel}>
        <span>{t.info.photoPending}</span>
      </div>
    );
  }
  return <img className="photo-image" src={url} alt={t.info.photoLabel} />;
}

export function InfoCard({ rows, imageUrl }: { rows: readonly InfoRow[]; imageUrl: string | null }) {
  return (
    <section className="card detail-card" aria-labelledby="detail-info-title">
      <h2 id="detail-info-title">{t.info.title}</h2>
      <div className="info-body">
        <DetailList rows={rows} className="detail-list info-list" />
        <Photo url={imageUrl} />
      </div>
    </section>
  );
}

/** `action` is the button that changes the place (move or assign), or nothing for an actor who cannot. */
export function LocationCard({ view, action }: { view: LocationView; action: ReactNode }) {
  return (
    <section className="card detail-card" aria-labelledby="detail-location-title">
      <h2 id="detail-location-title">{t.location.title}</h2>
      {view.assigned ? <DetailList rows={view.rows} className="detail-list place-list" /> : (
        <>
          <p className="location-none">{t.location.none}</p>
          <p className="hint">{view.hint}</p>
        </>
      )}
      {action !== null && <div className="detail-card-action">{action}</div>}
    </section>
  );
}

const BADGE: Readonly<Record<Tone, string>> = { ok: "badge-ok", warn: "badge-warn", danger: "badge-danger" };

function Ring({ view }: { view: Extract<MaintenanceView, { kind: "figures" }> }) {
  return (
    <div className="ring" data-tone={view.tone} style={{ "--ring-percent": `${String(view.percent)}%` } as CSSProperties}>
      <span className="ring-value">{view.consumed}</span>
      <span className="ring-caption">{t.maintenance.accumulated}</span>
      <span className="visually-hidden">{t.maintenance.ringLabel(view.percent)}</span>
    </div>
  );
}

function FigureRows({ view }: { view: Extract<MaintenanceView, { kind: "figures" }> }) {
  return (
    <dl className="detail-list">
      {view.rows.map((row) => (
        <div key={row.label} className="detail-row">
          <dt>{row.label}</dt>
          <dd data-tone={row.tone ?? undefined}>{row.value}</dd>
        </div>
      ))}
      <div className="detail-row">
        <dt>{t.maintenance.state}</dt>
        <dd><span className={`badge ${BADGE[view.tone]}`}>{view.stateLabel}</span></dd>
      </div>
    </dl>
  );
}

/** Hours and maintenance (issue 60 D3): the ring and the figures of the preventive cycle, or why there are none. */
export function MaintenanceCard({ view }: { view: MaintenanceView }) {
  return (
    <section className="card detail-card" aria-labelledby="detail-maintenance-title">
      <h2 id="detail-maintenance-title">{t.maintenance.title}</h2>
      {view.kind === "missing" ? <p className="location-none">{view.reason}</p> : (
        <div className="maintenance-body">
          <Ring view={view} />
          <FigureRows view={view} />
        </div>
      )}
    </section>
  );
}

export function ObservationsCard({ text }: { text: string | null }) {
  return (
    <section className="card detail-card observations-card" aria-labelledby="detail-observations-title">
      <h2 id="detail-observations-title">{t.observations.title}</h2>
      <p>{text === null || text.trim() === "" ? t.observations.none : text}</p>
    </section>
  );
}
