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
  filterEquipment,
  fleetHref,
  knownId,
  paginate,
  parseFleetTab,
  parsePage,
  supplierOptions,
  type FleetQuery,
  type FleetTab,
} from "../../_lib/fleet-view";
import { wantsArchived } from "../../_lib/organization-view";
import { requireActor } from "../../_lib/session";
import { NewEquipmentDialog } from "./equipment-dialogs";
import { NewAssetTypeDialog, NewSupplierDialog } from "./fleet-dialogs";
import { EquipmentToolbar, FleetTabs, Pagination } from "./fleet-toolbar";
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
  return <div className="empty-state" role="status"><p>{text}</p></div>;
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

type Params = {
  readonly tab?: string | readonly string[];
  readonly archived?: string | readonly string[];
  readonly q?: string | readonly string[];
  readonly supplier?: string | readonly string[];
  readonly type?: string | readonly string[];
  readonly page?: string | readonly string[];
};

function Actions({ data, tab }: { data: Data; tab: FleetTab }) {
  const options = { suppliers: supplierOptions(data.suppliers), assetTypes: assetTypeOptions(data.assetTypes) };
  return (
    <span className="head-actions">
      {tab === "suppliers" && <NewSupplierDialog />}
      {tab === "asset-types" && <NewAssetTypeDialog />}
      {tab === "equipment" && canCreateEquipment(options.suppliers, options.assetTypes) && <NewEquipmentDialog options={options} />}
    </span>
  );
}

function ArchivedToggle({ query, showing }: { query: FleetQuery; showing: boolean }) {
  return (
    <div className="toolbar">
      <a className="btn" href={fleetHref({ ...query, archived: !showing, page: 1 })}>{showing ? t.hideArchived : t.showArchived}</a>
    </div>
  );
}

type HeaderProps = Access & { data: Data; tab: FleetTab };

function Header({ data, canWrite, tab }: HeaderProps) {
  const needsFirstSteps = canWrite && !canCreateEquipment(supplierOptions(data.suppliers), assetTypeOptions(data.assetTypes));
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="page-sub">{t.subtitle}</p>
        </div>
        {canWrite && <Actions data={data} tab={tab} />}
      </header>
      {needsFirstSteps && <p className="hint">{t.createFirst}</p>}
    </>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="card section-card tab-panel">{children}</section>;
}

type PanelProps = Access & { data: Data; query: FleetQuery };

function SuppliersPanel({ data, query, ...access }: PanelProps) {
  const rows = buildSupplierRows(data.suppliers, data.equipment);
  return (
    <Panel>
      {access.canArchive && <ArchivedToggle query={query} showing={query.archived === true} />}
      {rows.length === 0 ? <Empty text={t.emptySuppliers} /> : <SuppliersTable rows={rows} {...access} />}
    </Panel>
  );
}

function AssetTypesPanel({ data, query, ...access }: PanelProps) {
  const rows = buildAssetTypeRows(data.assetTypes, data.equipment);
  return (
    <Panel>
      {access.canArchive && <ArchivedToggle query={query} showing={query.archived === true} />}
      {rows.length === 0 ? <Empty text={t.emptyAssetTypes} /> : <AssetTypesTable rows={rows} {...access} />}
    </Panel>
  );
}

function EquipmentPanel({ data, query, params, ...access }: PanelProps & { params: Params }) {
  const options = { suppliers: supplierOptions(data.suppliers), assetTypes: assetTypeOptions(data.assetTypes) };
  const all = buildEquipmentRows(data.equipment, data.suppliers, data.assetTypes);
  const page = paginate(filterEquipment(all, filtersOf(data, params)), parsePage(params.page));
  return (
    <Panel>
      <EquipmentToolbar filters={filtersOf(data, params)} archived={query.archived === true}
        suppliers={data.suppliers} types={data.assetTypes} />
      {access.canArchive && <ArchivedToggle query={query} showing={query.archived === true} />}
      {all.length === 0 && <Empty text={t.emptyEquipment} />}
      {all.length > 0 && page.total === 0 && <Empty text={t.noResults} />}
      {page.total > 0 && <EquipmentTable rows={page.items} options={options} {...access} />}
      {page.total > 0 && <Pagination page={page} query={{ ...query, page: page.page }} />}
    </Panel>
  );
}

const text = (raw: string | readonly string[] | undefined): string => (typeof raw === "string" ? raw.trim() : "");

function filtersOf(data: Data, params: Params) {
  return { q: text(params.q), supplierId: knownId(params.supplier, data.suppliers), typeId: knownId(params.type, data.assetTypes) };
}

function queryOf(data: Data, params: Params, tab: FleetTab, archived: boolean): FleetQuery {
  const { q, supplierId, typeId } = filtersOf(data, params);
  return tab === "equipment" ? { tab, archived, q, supplierId, typeId } : { tab, archived };
}

function countsOf(data: Data): Record<FleetTab, number> {
  return { equipment: data.equipment.length, suppliers: data.suppliers.length, "asset-types": data.assetTypes.length };
}

function Body({ data, params, tab, archived, ...access }: Access & { data: Data; params: Params; tab: FleetTab; archived: boolean }) {
  const query = queryOf(data, params, tab, archived);
  return (
    <>
      <FleetTabs active={tab} archived={archived} counts={countsOf(data)} />
      {tab === "suppliers" && <SuppliersPanel data={data} query={query} {...access} />}
      {tab === "asset-types" && <AssetTypesPanel data={data} query={query} {...access} />}
      {tab === "equipment" && <EquipmentPanel data={data} query={query} params={params} {...access} />}
    </>
  );
}

export default async function FleetPage({ searchParams }: { readonly searchParams: Promise<Params> }) {
  const context = await requireActor();
  const actor = toActor(context);
  const { accessPolicy } = getContainer();
  const position = { tenantId: actor.tenantId };
  if (!accessPolicy.check(actor, "catalog.read", position).ok) return <Restricted />;
  const canArchive = accessPolicy.check(actor, "catalog.archive", position).ok;
  const params = await searchParams;
  const archived = canArchive && wantsArchived(params.archived);
  const data = await loadFleet(actor, archived);
  if (data === null) return <Restricted />;
  const canWrite = accessPolicy.check(actor, "catalog.write", position).ok;
  const tab = parseFleetTab(params.tab);
  return (
    <>
      <Header data={data} canWrite={canWrite} canArchive={canArchive} tab={tab} />
      <Body data={data} params={params} tab={tab} archived={archived} canWrite={canWrite} canArchive={canArchive} />
    </>
  );
}
