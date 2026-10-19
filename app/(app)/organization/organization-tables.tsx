import { copy } from "../../_lib/copy";
import type { DivisionGroup, OperationRow, SiteRow } from "../../_lib/organization-view";
import { ArchiveDialog, EditOperationDialog, RenameDialog, type EditOptions, type RenameKind } from "./organization-dialogs";

const t = copy.organization;

type Access = { readonly canWrite: boolean; readonly canArchive: boolean };
type WriteAccess = Access & { readonly options: EditOptions };

function ArchivedTag() {
  return <span className="badge badge-neutral">{copy.common.archivedTag}</span>;
}

type ArchiveControlProps = { readonly kind: RenameKind; readonly archived: boolean; readonly target: { id: string; name: string } };

/** Archived rows only offer "Reactivar"; active rows offer "Dar de baja". Nothing without `catalog.archive`. */
function ArchiveControl({ kind, archived, target, canArchive }: ArchiveControlProps & { canArchive: boolean }) {
  if (!canArchive) return null;
  return <ArchiveDialog kind={kind} verb={archived ? "restore" : "archive"} target={target} />;
}

function OperationActions({ row, canWrite, canArchive, options }: WriteAccess & { row: OperationRow }) {
  return (
    <>
      {canWrite && !row.archived && <EditOperationDialog target={row} options={options} />}
      {canWrite && !row.archived && <RenameDialog kind="operation" target={row} />}
      <ArchiveControl kind="operation" archived={row.archived} target={row} canArchive={canArchive} />
    </>
  );
}

function OperationLine(props: WriteAccess & { row: OperationRow }) {
  const { row } = props;
  return (
    <tr data-archived={row.archived}>
      <td className="cell-code">{row.costCenter}</td>
      <th scope="row">{row.name} {row.archived && <ArchivedTag />}</th>
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

function OperationsTable({ group, ...access }: WriteAccess & { group: DivisionGroup }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{t.divisionsCaption(group.name ?? t.otherDivision)}</caption>
        <OperationsHead />
        <tbody>
          {group.operations.map((row) => (
            <OperationLine key={row.id} row={row} {...access} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GroupHeader({ group, canWrite, canArchive }: Access & { group: DivisionGroup }) {
  const target = group.id !== null && group.name !== null ? { id: group.id, name: group.name } : null;
  return (
    <header className="group-head">
      <h3>{group.name ?? t.otherDivision}</h3>
      {group.archived && <ArchivedTag />}
      <span className="cell-sub">{t.operationCount(group.activeOperations)}</span>
      {canWrite && !group.archived && target !== null && <RenameDialog kind="division" target={target} />}
      {target !== null && <ArchiveControl kind="division" archived={group.archived} target={target} canArchive={canArchive} />}
    </header>
  );
}

export function DivisionCard({ group, ...access }: WriteAccess & { group: DivisionGroup }) {
  return (
    <section className="card group-card" data-archived={group.archived}>
      <GroupHeader group={group} canWrite={access.canWrite} canArchive={access.canArchive} />
      {group.operations.length === 0
        ? <p className="cell-sub">{t.noOperations}</p>
        : <OperationsTable group={group} {...access} />}
    </section>
  );
}

function SiteLine({ row, canWrite, canArchive }: Access & { row: SiteRow }) {
  return (
    <tr data-archived={row.archived}>
      <th scope="row">{row.name} {row.archived && <ArchivedTag />}</th>
      <td>{row.operationCount}</td>
      <td className="cell-actions">
        {canWrite && !row.archived && <RenameDialog kind="site" target={row} />}
        <ArchiveControl kind="site" archived={row.archived} target={row} canArchive={canArchive} />
      </td>
    </tr>
  );
}

export function SitesTable({ rows, ...access }: Access & { rows: readonly SiteRow[] }) {
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
          {rows.map((row) => <SiteLine key={row.id} row={row} {...access} />)}
        </tbody>
      </table>
    </div>
  );
}
