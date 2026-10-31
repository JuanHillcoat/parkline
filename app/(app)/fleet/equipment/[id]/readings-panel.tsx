import { copy } from "../../../../_lib/copy";
import type { ReadingActions, ReadingViewRow, ReadingsView } from "../../../../_lib/readings-view";
import { CorrectReadingDialog, ReplaceMeterDialog } from "./reading-dialogs";

const t = copy.fleet.detail.readings;

type Target = { readonly id: string; readonly code: string };
type Common = { readonly target: Target; readonly today: string; readonly actions: ReadingActions };
type Meter = Extract<ReadingsView, { kind: "meter" }>;

function Toolbar({ target, today, actions }: Common) {
  if (!actions.replace) return null;
  return (
    <span className="head-actions" role="group" aria-label={t.toolbar}>
      <ReplaceMeterDialog target={target} today={today} />
    </span>
  );
}

function Summary({ view }: { view: Meter }) {
  return (
    <dl className="detail-list">
      {view.meter !== null && (
        <>
          <div className="detail-row"><dt>{t.meterKind}</dt><dd>{view.meter.label}</dd></div>
          <div className="detail-row"><dt>{t.meterOpened}</dt><dd>{view.meter.opened}</dd></div>
        </>
      )}
      <div className="detail-row">
        <dt>{t.hoursTitle[view.unit]}</dt>
        <dd>
          <span data-testid="hours-last-30">{view.hours.text}</span>
          {view.hours.incomplete && <span className="badge badge-warn" title={t.incompleteHint}>{t.incomplete}</span>}
        </dd>
      </div>
    </dl>
  );
}

function PillOf({ row }: { row: ReadingViewRow }) {
  const tone = row.kind === "correction" ? "badge-info" : row.kind === "reading" ? "badge-ok" : "badge-neutral";
  return <span className={`badge ${tone}`}>{row.kindLabel}</span>;
}

/** A superseded row no longer counts: its latest correction (or the original, if none) is the row to correct. */
function CorrectCell({ row, equipmentId }: { row: ReadingViewRow; equipmentId: string }) {
  const open = !row.superseded;
  return (
    <td className="cell-actions">
      <div className="row-actions">
        {open && <CorrectReadingDialog equipmentId={equipmentId} readingId={row.id} day={row.form.day} value={row.form.value} />}
      </div>
    </td>
  );
}

type LineProps = { row: ReadingViewRow; equipmentId: string; canCorrect: boolean };

function Line({ row, equipmentId, canCorrect }: LineProps) {
  return (
    <tr data-superseded={row.superseded}>
      <th scope="row">{row.day}</th>
      <td data-label={t.value}>{row.value}</td>
      <td data-label={t.kind}>
        <PillOf row={row} />
        {row.superseded && <span className="badge badge-neutral">{t.superseded}</span>}
      </td>
      <td data-label={t.by}>{row.who}</td>
      <td data-label={t.reason}>{row.reason}</td>
      {canCorrect && <CorrectCell row={row} equipmentId={equipmentId} />}
    </tr>
  );
}

function History({ view, equipmentId, canCorrect }: { view: Meter; equipmentId: string; canCorrect: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t.caption}</caption>
        <thead>
          <tr>
            {[t.day, t.value, t.kind, t.by, t.reason].map((label) => <th key={label} scope="col">{label}</th>)}
            {canCorrect && <th scope="col"><span className="visually-hidden">{t.actions}</span></th>}
          </tr>
        </thead>
        <tbody>{view.rows.map((row) => <Line key={row.id} row={row} equipmentId={equipmentId} canCorrect={canCorrect} />)}</tbody>
      </table>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <div className="empty-state" role="status"><p>{text}</p></div>;
}

/**
 * The Lecturas tab: the open meter, the hours of the last 30 days and the history, newest first. An
 * equipment without a meter shows only its notice. Replacing the meter follows the permissions given in `actions`;
 * loading a reading lives in the page header.
 */
export function ReadingsPanel(props: Common & { view: ReadingsView }) {
  const { view, target, actions } = props;
  if (view.kind === "none") {
    return <section className="card section-card tab-panel" aria-label={t.title}><Notice text={t.noMeter} /></section>;
  }
  return (
    <section className="card section-card tab-panel" aria-label={t.title}>
      <Toolbar {...props} />
      <Summary view={view} />
      {view.rows.length === 0 ? (
        <Notice text={actions.load ? t.empty : t.emptyReadOnly} />
      ) : (
        <History view={view} equipmentId={target.id} canCorrect={actions.correct} />
      )}
    </section>
  );
}
