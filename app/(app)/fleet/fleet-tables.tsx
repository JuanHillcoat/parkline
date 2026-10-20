import type { ReactNode } from "react";
import { copy } from "../../_lib/copy";
import type { AssetTypeRow, EquipmentRow, SupplierRow } from "../../_lib/fleet-view";
import { EditEquipmentDialog, type EquipmentOptions } from "./equipment-dialogs";
import { ArchiveDialog, EditAssetTypeDialog, RenameSupplierDialog, type FleetKind } from "./fleet-dialogs";

const t = copy.fleet;
const c = t.columns;

export type Access = { readonly canWrite: boolean; readonly canArchive: boolean };

function ArchivedTag() {
  return <span className="badge badge-neutral">{copy.common.archivedTag}</span>;
}

type ControlProps = Access & { readonly kind: FleetKind; readonly archived: boolean; readonly target: { id: string; name: string } };

/** Archived rows only offer "Reactivar"; active rows offer "Dar de baja". Nothing without `catalog.archive`. */
function ArchiveControl({ kind, archived, target, canArchive }: ControlProps) {
  if (!canArchive) return null;
  return <ArchiveDialog kind={kind} verb={archived ? "restore" : "archive"} target={target} />;
}

function TableShell({ caption, head, children }: { caption: string; head: readonly string[]; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {head.map((label) => <th key={label} scope="col">{label}</th>)}
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
      <td>{row.activeEquipment}</td>
      <td className="cell-actions">
        {access.canWrite && !row.archived && <RenameSupplierDialog target={row} />}
        <ArchiveControl kind="supplier" archived={row.archived} target={row} {...access} />
      </td>
    </tr>
  );
}

export function SuppliersTable({ rows, ...access }: Access & { rows: readonly SupplierRow[] }) {
  return (
    <TableShell caption={t.suppliersCaption} head={[c.supplier, c.activeEquipment]}>
      {rows.map((row) => <SupplierLine key={row.id} row={row} {...access} />)}
    </TableShell>
  );
}

function AssetTypeLine({ row, ...access }: Access & { row: AssetTypeRow }) {
  return (
    <tr data-archived={row.archived}>
      <th scope="row">{row.name} {row.archived && <ArchivedTag />}</th>
      <td>{row.meterLabel}</td>
      <td>{row.intervalText}</td>
      <td>{row.activeEquipment}</td>
      <td className="cell-actions">
        {access.canWrite && !row.archived && <EditAssetTypeDialog target={row} />}
        <ArchiveControl kind="assetType" archived={row.archived} target={row} {...access} />
      </td>
    </tr>
  );
}

export function AssetTypesTable({ rows, ...access }: Access & { rows: readonly AssetTypeRow[] }) {
  return (
    <TableShell caption={t.assetTypesCaption} head={[c.assetType, c.meter, c.interval, c.activeEquipment]}>
      {rows.map((row) => <AssetTypeLine key={row.id} row={row} {...access} />)}
    </TableShell>
  );
}

const orDash = (value: string | number | null): string => value?.toString() ?? t.noValue;

function BrandModelCell({ row }: { row: EquipmentRow }) {
  return (
    <td title={row.observations ?? undefined}>
      {orDash(row.brandModel)}
      {row.observations !== null && <span className="cell-sub cell-note">{row.observations}</span>}
    </td>
  );
}

type EquipmentLineProps = Access & { readonly row: EquipmentRow; readonly options: EquipmentOptions };

function EquipmentLine({ row, options, ...access }: EquipmentLineProps) {
  return (
    <tr data-archived={row.archived}>
      <th scope="row" className="cell-code">{row.internalCode} {row.archived && <ArchivedTag />}</th>
      <td>{row.supplierName ?? t.unknownParent}</td>
      <td>{row.assetTypeName ?? t.unknownParent}</td>
      <BrandModelCell row={row} />
      <td>{orDash(row.year)}</td>
      <td>{orDash(row.serialNumber)}</td>
      <td>{orDash(row.batteryQuantity)}</td>
      <td className="cell-actions">
        {access.canWrite && !row.archived && <EditEquipmentDialog target={row} options={options} />}
        <ArchiveControl kind="equipment" archived={row.archived} target={{ id: row.id, name: row.internalCode }} {...access} />
      </td>
    </tr>
  );
}

const EQUIPMENT_HEAD = [c.internalCode, c.supplier, c.assetType, c.brandModel, c.year, c.serialNumber, c.batteries];

export function EquipmentTable({ rows, options, ...access }: Access & { rows: readonly EquipmentRow[]; options: EquipmentOptions }) {
  return (
    <TableShell caption={t.equipmentCaption} head={EQUIPMENT_HEAD}>
      {rows.map((row) => <EquipmentLine key={row.id} row={row} options={options} {...access} />)}
    </TableShell>
  );
}
