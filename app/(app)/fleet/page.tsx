import type { ReactNode } from "react";
import { toActor } from "../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { copy } from "../../_lib/copy";
import {
  assetTypeOptions,
  buildAssetTypeRows,
  buildEquipmentRows,
  buildSupplierRows,
  canCreateEquipment,
  fleetToggleHref,
  supplierOptions,
} from "../../_lib/fleet-view";
import { wantsArchived } from "../../_lib/organization-view";
import { requireActor } from "../../_lib/session";
import { NewEquipmentDialog } from "./equipment-dialogs";
import { NewAssetTypeDialog, NewSupplierDialog } from "./fleet-dialogs";
import { AssetTypesTable, EquipmentTable, SuppliersTable, type Access } from "./fleet-tables";

export const metadata = { title: copy.fleet.pageTitle };

const t = copy.fleet;

type Actor = ReturnType<typeof toActor>;

function Restricted() {
  return (
    <section className="card" role="status">
      <h1>{t.restrictedTitle}</h1>
      <p>{t.restrictedText}</p>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="card empty-note" role="status">{text}</p>;
}

/** Reads only through the list use cases, which already filter by the actor's scopes. */
async function loadFleet(actor: Actor, includeArchived: boolean) {
  const { fleet } = getContainer();
  const [suppliers, assetTypes, equipment] = await Promise.all([
    fleet.listSuppliers.execute({ actor, includeArchived }),
    fleet.listAssetTypes.execute({ actor, includeArchived }),
    fleet.listEquipment.execute({ actor, includeArchived }),
  ]);
  if (!suppliers.ok || !assetTypes.ok || !equipment.ok) return null;
  return { suppliers: suppliers.value, assetTypes: assetTypes.value, equipment: equipment.value };
}

type Data = NonNullable<Awaited<ReturnType<typeof loadFleet>>>;

function Actions({ data }: { data: Data }) {
  const options = { suppliers: supplierOptions(data.suppliers), assetTypes: assetTypeOptions(data.assetTypes) };
  return (
    <span className="head-actions">
      <NewSupplierDialog />
      <NewAssetTypeDialog />
      {canCreateEquipment(options.suppliers, options.assetTypes) && <NewEquipmentDialog options={options} />}
    </span>
  );
}

function ArchivedToggle({ showing }: { showing: boolean }) {
  return (
    <p>
      <a className="btn btn-link" href={fleetToggleHref(showing)}>{showing ? t.hideArchived : t.showArchived}</a>
    </p>
  );
}

function Header({ data, canWrite, canArchive, showArchived }: Access & { data: Data; showArchived: boolean }) {
  const needsFirstSteps = canWrite && !canCreateEquipment(supplierOptions(data.suppliers), assetTypeOptions(data.assetTypes));
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="page-sub">{t.subtitle}</p>
        </div>
        {canWrite && <Actions data={data} />}
      </header>
      {canArchive && <ArchivedToggle showing={showArchived} />}
      {needsFirstSteps && <p className="hint">{t.createFirst}</p>}
    </>
  );
}

function Section({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <>
      <h2 className="section-title">{title} {count !== undefined && <span className="cell-sub">{count}</span>}</h2>
      {children}
    </>
  );
}

function Catalogs({ data, ...access }: Access & { data: Data }) {
  const suppliers = buildSupplierRows(data.suppliers, data.equipment);
  const types = buildAssetTypeRows(data.assetTypes, data.equipment);
  return (
    <>
      <Section title={t.suppliersTitle}>
        {suppliers.length === 0 ? <Empty text={t.emptySuppliers} /> : <SuppliersTable rows={suppliers} {...access} />}
      </Section>
      <Section title={t.assetTypesTitle}>
        {types.length === 0 ? <Empty text={t.emptyAssetTypes} /> : <AssetTypesTable rows={types} {...access} />}
      </Section>
    </>
  );
}

function EquipmentSection({ data, ...access }: Access & { data: Data }) {
  const rows = buildEquipmentRows(data.equipment, data.suppliers, data.assetTypes);
  const options = { suppliers: supplierOptions(data.suppliers), assetTypes: assetTypeOptions(data.assetTypes) };
  const active = rows.filter((row) => !row.archived).length;
  return (
    <Section title={t.equipmentTitle} count={t.equipmentCount(active)}>
      {rows.length === 0 ? <Empty text={t.emptyEquipment} /> : <EquipmentTable rows={rows} options={options} {...access} />}
    </Section>
  );
}

type PageProps = { readonly searchParams: Promise<{ readonly archived?: string | readonly string[] }> };

export default async function FleetPage({ searchParams }: PageProps) {
  const context = await requireActor();
  const actor = toActor(context);
  const { accessPolicy } = getContainer();
  const position = { tenantId: actor.tenantId };
  if (!accessPolicy.check(actor, "catalog.read", position).ok) return <Restricted />;
  const canArchive = accessPolicy.check(actor, "catalog.archive", position).ok;
  const showArchived = canArchive && wantsArchived((await searchParams).archived);
  const data = await loadFleet(actor, showArchived);
  if (data === null) return <Restricted />;
  const canWrite = accessPolicy.check(actor, "catalog.write", position).ok;
  return (
    <>
      <Header data={data} canWrite={canWrite} canArchive={canArchive} showArchived={showArchived} />
      <Catalogs data={data} canWrite={canWrite} canArchive={canArchive} />
      <EquipmentSection data={data} canWrite={canWrite} canArchive={canArchive} />
    </>
  );
}
