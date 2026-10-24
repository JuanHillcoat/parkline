import type { ReactNode } from "react";
import { copy } from "../../_lib/copy";
import type { AssetTypeRow, EquipmentRow, EquipmentState, SupplierRow } from "../../_lib/fleet-view";
import { EditEquipmentDialog, type EquipmentOptions } from "./equipment-dialogs";
import { ArchiveDialog, EditAssetTypeDialog, RenameSupplierDialog, type FleetKind } from "./fleet-dialogs";

const t = copy.fleet;
const c = t.columns;

export type Access = { readonly canWrite: boolean; readonly canArchive: boolean };

const STATE_BADGE: Readonly<Record<EquipmentState, string>> = {
  active: "badge badge-ok",
  spare: "badge badge-warn",
  unassigned: "badge badge-neutral",
};

/** Archived equipment keeps its "De baja" pill; otherwise the pill shows where it stands (Activo, Muleto, Sin asignar). */
function EquipmentStatePill({ row }: { row: EquipmentRow }) {
  if (row.archived) return <ArchivedTag />;
  return <span className={STATE_BADGE[row.state]}>{t.state[row.state]}</span>;
}

function ArchivedTag() {
  return <span className="badge badge-neutral">{copy.common.archivedTag}</span>;
}

type ControlProps = Access & { readonly kind: FleetKind; readonly archived: boolean; readonly target: { id: string; name: string } };

/** Archived rows only offer "Reactivar"; active rows offer "Dar de baja". Nothing without `catalog.archive`. */
function ArchiveControl({ kind, archived, target, canArchive }: ControlProps) {
  if (!canArchive) return null;
  return <ArchiveDialog kind={kind} verb={archived ? "restore" : "archive"} target={target} />;
}

type ShellProps = { caption: string; head: readonly string[]; numeric?: readonly number[]; children: ReactNode };

function TableShell({ caption, head, numeric = [], children }: ShellProps) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((label, index) => <th key={label} scope="col" className={numeric.includes(index) ? "cell-num" : undefined}>{label}</th>)}
            <th scope="col"><span className="visually-hidden">{c.actions}</span></th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function SupplierLine({ row, ...access }: Access & { row: SupplierRow }) {
  return (
    <tr data-archived={row.archived}>
      <th scope="row">{row.name} {row.archived && <ArchivedTag />}</th>
      <td className="cell-num" data-label={c.activeEquipment}>{row.activeEquipment}</td>
      <td className="cell-actions">
        <div className="row-actions">
          {access.canWrite && !row.archived && <RenameSupplierDialog target={row} />}
          <ArchiveControl kind="supplier" archived={row.archived} target={row} {...access} />
        </div>
      </td>
    </tr>
  );
}

export function SuppliersTable({ rows, ...access }: Access & { rows: readonly SupplierRow[] }) {
  return (
    <TableShell caption={t.suppliersCaption} head={[c.supplier, c.activeEquipment]} numeric={[1]}>
      {rows.map((row) => <SupplierLine key={row.id} row={row} {...access} />)}
    </TableShell>
  );
}

function AssetTypeLine({ row, ...access }: Access & { row: AssetTypeRow }) {
  return (
    <tr data-archived={row.archived}>
      <th scope="row">{row.name} {row.archived && <ArchivedTag />}</th>
      <td data-label={c.meter}>{row.meterLabel}</td>
      <td data-label={c.interval}>{row.intervalText}</td>
      <td className="cell-num" data-label={c.activeEquipment}>{row.activeEquipment}</td>
      <td className="cell-actions">
        <div className="row-actions">
          {access.canWrite && !row.archived && <EditAssetTypeDialog target={row} />}
          <ArchiveControl kind="assetType" archived={row.archived} target={row} {...access} />
        </div>
      </td>
    </tr>
  );
}

export function AssetTypesTable({ rows, ...access }: Access & { rows: readonly AssetTypeRow[] }) {
  return (
    <TableShell caption={t.assetTypesCaption} head={[c.assetType, c.meter, c.interval, c.activeEquipment]} numeric={[3]}>
      {rows.map((row) => <AssetTypeLine key={row.id} row={row} {...access} />)}
    </TableShell>
  );
}

const orDash = (value: string | number | null): string => value?.toString() ?? t.noValue;

function BrandModelCell({ row }: { row: EquipmentRow }) {
  return (
    <td title={row.observations ?? undefined} data-label={c.brandModel}>
      {orDash(row.brandModel)}
      {row.serialNumber !== null && <span className="cell-sub cell-stack">{t.serialPrefix} {row.serialNumber}</span>}
      {row.observations !== null && <span className="cell-sub cell-note">{row.observations}</span>}
    </td>
  );
}

type EquipmentLineProps = Access & { readonly row: EquipmentRow; readonly options: EquipmentOptions };

function EquipmentLine({ row, options, ...access }: EquipmentLineProps) {
  return (
    <tr data-archived={row.archived}>
      <th scope="row" className="cell-code cell-id">{row.internalCode}</th>
      <td data-label={c.assetType}>{row.assetTypeName}</td>
      <td data-label={c.supplier}>{row.supplierName}</td>
      <td data-label={c.operation}>{orDash(row.operationName)}</td>
      <td data-label={c.site}>{orDash(row.siteName)}</td>
      <BrandModelCell row={row} />
      <td className="cell-num" data-label={c.year}>{orDash(row.year)}</td>
      <td data-label={c.status}><EquipmentStatePill row={row} /></td>
      <td className="cell-actions">
        <div className="row-actions">
          {access.canWrite && !row.archived && <EditEquipmentDialog target={row} options={options} />}
          <ArchiveControl kind="equipment" archived={row.archived} target={{ id: row.id, name: row.internalCode }} {...access} />
        </div>
      </td>
    </tr>
  );
}

const EQUIPMENT_HEAD = [c.internalCode, c.assetType, c.supplier, c.operation, c.site, c.brandModel, c.year, c.status];

export function EquipmentTable({ rows, options, ...access }: Access & { rows: readonly EquipmentRow[]; options: EquipmentOptions }) {
  return (
    <TableShell caption={t.equipmentCaption} head={EQUIPMENT_HEAD} numeric={[6]}>
      {rows.map((row) => <EquipmentLine key={row.id} row={row} options={options} {...access} />)}
    </TableShell>
  );
}
