import { copy } from "../../_lib/copy";
import type { DivisionGroup, OperationRow, SiteRow } from "../../_lib/organization-view";
import { EditOperationDialog, RenameDialog, type EditOptions } from "./organization-dialogs";

const t = copy.organization;

type WriteAccess = { readonly canWrite: boolean; readonly options: EditOptions };

function OperationActions({ row, canWrite, options }: WriteAccess & { row: OperationRow }) {
  if (!canWrite) return null;
  return (
    <>
      <EditOperationDialog target={row} options={options} />
      <RenameDialog kind="operation" target={row} />
    </>
  );
}

function OperationLine(props: WriteAccess & { row: OperationRow }) {
  const { row } = props;
  return (
    <tr>
      <td className="cell-code">{row.costCenter}</td>
      <th scope="row">{row.name}</th>
      <td>{row.siteName ?? <span className="cell-sub">{t.noSite}</span>}</td>
      <td className="cell-actions"><OperationActions {...props} /></td>
    </tr>
  );
}

function OperationsHead() {
  const c = t.columns;
  return (
    <thead>
      <tr>
        <th scope="col">{c.costCenter}</th>
        <th scope="col">{c.operation}</th>
        <th scope="col">{c.site}</th>
        <th scope="col"><span className="visually-hidden">{c.actions}</span></th>
      </tr>
    </thead>
  );
}

function OperationsTable({ group, canWrite, options }: WriteAccess & { group: DivisionGroup }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t.divisionsCaption(group.name ?? t.otherDivision)}</caption>
        <OperationsHead />
        <tbody>
          {group.operations.map((row) => (
            <OperationLine key={row.id} row={row} canWrite={canWrite} options={options} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupHeader({ group, canWrite }: { group: DivisionGroup; canWrite: boolean }) {
  return (
    <header className="group-head">
      <h3>{group.name ?? t.otherDivision}</h3>
      <span className="cell-sub">{t.operationCount(group.operations.length)}</span>
      {canWrite && group.id !== null && group.name !== null && (
        <RenameDialog kind="division" target={{ id: group.id, name: group.name }} />
      )}
    </header>
  );
}

export function DivisionCard({ group, canWrite, options }: WriteAccess & { group: DivisionGroup }) {
  return (
    <section className="card group-card">
      <GroupHeader group={group} canWrite={canWrite} />
      {group.operations.length === 0
        ? <p className="cell-sub">{t.noOperations}</p>
        : <OperationsTable group={group} canWrite={canWrite} options={options} />}
    </section>
  );
}

function SiteLine({ row, canWrite }: { row: SiteRow; canWrite: boolean }) {
  return (
    <tr>
      <th scope="row">{row.name}</th>
      <td>{row.operationCount}</td>
      <td className="cell-actions">{canWrite && <RenameDialog kind="site" target={row} />}</td>
    </tr>
  );
}

export function SitesTable({ rows, canWrite }: { rows: readonly SiteRow[]; canWrite: boolean }) {
  const c = t.columns;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t.sitesCaption}</caption>
        <thead>
          <tr>
            <th scope="col">{c.site}</th>
            <th scope="col">{c.operations}</th>
            <th scope="col"><span className="visually-hidden">{c.actions}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <SiteLine key={row.id} row={row} canWrite={canWrite} />)}
        </tbody>
      </table>
    </div>
  );
}
