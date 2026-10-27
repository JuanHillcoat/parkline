import type { Option } from "../../../../_components/form-fields";
import { copy } from "../../../../_lib/copy";
import type { HistoryRow } from "../../../../_lib/equipment-detail-view";
import { CorrectDialog } from "./assignment-dialogs";

const t = copy.fleet.detail.history;

type Props = {
  readonly equipmentId: string;
  readonly rows: readonly HistoryRow[];
  /** Only writers see "Corregir"; the server action enforces the permission again. */
  readonly canCorrect: boolean;
  readonly operationsFor: (row: HistoryRow) => readonly Option[];
  readonly sitesFor: (row: HistoryRow) => readonly Option[];
};

function KindPill({ row }: { row: HistoryRow }) {
  return <span className={row.form.kind === "spare" ? "badge badge-warn" : "badge badge-ok"}>{row.kindLabel}</span>;
}

function CorrectCell({ row, equipmentId, operationsFor, sitesFor }: Props & { row: HistoryRow }) {
  return (
    <td className="cell-actions">
      <div className="row-actions">
        <CorrectDialog equipmentId={equipmentId} assignmentId={row.id} values={row.form} operations={operationsFor(row)} sites={sitesFor(row)} />
      </div>
    </td>
  );
}

function HistoryLine(props: Props & { row: HistoryRow }) {
  const { row } = props;
  return (
    <tr data-open={row.open}>
      <th scope="row">{row.from}</th>
      <td data-label={t.to}>{row.open ? <span className="badge badge-ok">{row.to}</span> : row.to}</td>
      <td data-label={t.operation}>{row.operationName}</td>
      <td data-label={t.site}>{row.siteName}</td>
      <td data-label={t.kind}><KindPill row={row} /></td>
      <td data-label={t.reason}>{row.reason}</td>
      {props.canCorrect && <CorrectCell {...props} />}
    </tr>
  );
}

function HistoryHead({ canCorrect }: { canCorrect: boolean }) {
  return (
    <thead>
      <tr>
        {[t.from, t.to, t.operation, t.site, t.kind, t.reason].map((label) => <th key={label} scope="col">{label}</th>)}
        {canCorrect && <th scope="col"><span className="visually-hidden">{t.actions}</span></th>}
      </tr>
    </thead>
  );
}

/** The timeline of assignments, newest first (S1): from, to, operation, site, kind and reason. */
export function HistoryPanel(props: Props) {
  if (props.rows.length === 0) {
    return <div className="empty-state" role="status"><p>{t.empty}</p></div>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t.caption}</caption>
        <HistoryHead canCorrect={props.canCorrect} />
        <tbody>{props.rows.map((row) => <HistoryLine key={row.id} {...props} row={row} />)}</tbody>
      </table>
    </div>
  );
}
