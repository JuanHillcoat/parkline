import type { ReactNode } from "react";
import type { ActorContext } from "../../../src/identity/application/actor-context";
import { toActor } from "../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { ok, type Result } from "../../../src/shared/domain/result";
import { canViewFleet, canViewFleetCatalogs } from "../../_lib/catalog-access";
import { copy } from "../../_lib/copy";
import {
  assetTypeNamesOf,
  assetTypeOptions,
  buildAssetTypeRows,
  buildEquipmentRows,
  buildSupplierRows,
  canCreateEquipment,
  filterEquipment,
  fleetHref,
  knownId,
  operationOptions,
  paginate,
  parseEquipmentState,
  parseFleetTab,
  parsePage,
  siteOptions,
  supplierNamesOf,
  supplierOptions,
  type FleetQuery,
  type FleetTab,
  listOrEmpty,
} from "../../_lib/fleet-view";
import { wantsArchived } from "../../_lib/organization-view";
import { dayOf } from "../../../src/fleet/domain/day";
import { requireActor } from "../../_lib/session";
import { EquipmentGuidance } from "./equipment-guidance";
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

/** `action` is the creation button for a writer: the empty list is where they look for it. */
function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return <div className="empty-state" role="status"><p>{text}</p>{action}</div>;
}

type Listed<T> = Promise<Result<readonly T[], unknown>>;

/** Suppliers and asset types are tenant-wide (D6 of ADR-0007): a scoped reader gets none instead of a refusal. */
const wideOnly = <T,>(wide: boolean, run: () => Listed<T>): Listed<T> => (wide ? run() : Promise.resolve(ok([])));

/** Reads only through the list use cases, which already filter by the actor's scopes. */
async function loadFleet(actor: Actor, includeArchived: boolean, wide: boolean) {
  const { fleet, organization } = getContainer();
  const [suppliers, assetTypes, equipment, operations, sites] = await Promise.all([
    wideOnly(wide, () => fleet.listSuppliers.execute({ actor, includeArchived })),
    wideOnly(wide, () => fleet.listAssetTypes.execute({ actor, includeArchived })),
    fleet.listEquipment.execute({ actor, includeArchived }),
    organization.listOperations.execute({ actor }),
    organization.listSites.execute({ actor }),
  ]);
  if (!suppliers.ok || !assetTypes.ok || !equipment.ok) return null;
  return {
    wide,
    suppliers: suppliers.value,
    assetTypes: assetTypes.value,
    equipment: equipment.value,
    operations: listOrEmpty(operations),
    sites: listOrEmpty(sites),
  };
}

type Data = NonNullable<Awaited<ReturnType<typeof loadFleet>>>;

type Params = {
  readonly tab?: string | readonly string[];
  readonly archived?: string | readonly string[];
  readonly q?: string | readonly string[];
  readonly supplier?: string | readonly string[];
  readonly type?: string | readonly string[];
  readonly operation?: string | readonly string[];
  readonly state?: string | readonly string[];
  readonly page?: string | readonly string[];
};

function Actions({ data, tab }: { data: Data; tab: FleetTab }) {
  const options = { suppliers: supplierOptions(data.suppliers), assetTypes: assetTypeOptions(data.assetTypes) };
  return (
    <span className="head-actions">
      {tab === "suppliers" && data.suppliers.length > 0 && <NewSupplierDialog />}
      {tab === "asset-types" && data.assetTypes.length > 0 && <NewAssetTypeDialog />}
      {tab === "equipment" && canCreateEquipment(options.suppliers, options.assetTypes) && <NewEquipmentDialog options={options} operations={operationOptions(data.operations)} sites={siteOptions(data.sites)} today={dayOf(new Date())} />}
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
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="page-sub">{data.wide ? t.subtitle : t.subtitleScoped}</p>
        </div>
        {canWrite && <Actions data={data} tab={tab} />}
      </header>
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
      {rows.length === 0 ? <Empty text={t.emptySuppliers} action={access.canWrite ? <NewSupplierDialog /> : undefined} /> : <SuppliersTable rows={rows} {...access} />}
    </Panel>
  );
}

function AssetTypesPanel({ data, query, ...access }: PanelProps) {
  const rows = buildAssetTypeRows(data.assetTypes, data.equipment);
  return (
    <Panel>
      {access.canArchive && <ArchivedToggle query={query} showing={query.archived === true} />}
      {rows.length === 0 ? <Empty text={t.emptyAssetTypes} action={access.canWrite ? <NewAssetTypeDialog /> : undefined} /> : <AssetTypesTable rows={rows} {...access} />}
    </Panel>
  );
}

/** Filter choices: the catalogs for a company-wide reader, the names carried by the visible equipment otherwise. */
function filterOptions(data: Data) {
  return {
    suppliers: data.wide ? data.suppliers.map(({ id, name }) => ({ id, name })) : supplierNamesOf(data.equipment),
    types: data.wide ? data.assetTypes.map(({ id, name }) => ({ id, name })) : assetTypeNamesOf(data.equipment),
    operations: operationOptions(data.operations),
  };
}

function EquipmentGuide({ data, canWrite }: { data: Data; canWrite: boolean }) {
  const suppliers = supplierOptions(data.suppliers);
  const assetTypes = assetTypeOptions(data.assetTypes);
  if (!canWrite || canCreateEquipment(suppliers, assetTypes)) return null;
  return <EquipmentGuidance suppliers={suppliers} assetTypes={assetTypes} />;
}

function EquipmentPanel({ data, query, params, ...access }: PanelProps & { params: Params }) {
  const options = { suppliers: supplierOptions(data.suppliers), assetTypes: assetTypeOptions(data.assetTypes) };
  const all = buildEquipmentRows(data.equipment, data);
  const filters = filtersOf(data, params);
  const page = paginate(filterEquipment(all, filters), parsePage(params.page));
  return (
    <>
      <EquipmentGuide data={data} canWrite={access.canWrite} />
      <Panel>
        <EquipmentToolbar filters={filters} archived={query.archived === true} {...filterOptions(data)} />
        {access.canArchive && <ArchivedToggle query={query} showing={query.archived === true} />}
        {all.length === 0 && <Empty text={data.wide ? t.emptyEquipment : t.emptyScoped} />}
        {all.length > 0 && page.total === 0 && <Empty text={t.noResults} />}
        {page.total > 0 && <EquipmentTable rows={page.items} options={options} {...access} />}
        {page.total > 0 && <Pagination page={page} query={{ ...query, page: page.page }} />}
      </Panel>
    </>
  );
}

const text = (raw: string | readonly string[] | undefined): string => (typeof raw === "string" ? raw.trim() : "");

function filtersOf(data: Data, params: Params) {
  const options = filterOptions(data);
  return {
    q: text(params.q),
    supplierId: knownId(params.supplier, options.suppliers),
    typeId: knownId(params.type, options.types),
    operationId: knownId(params.operation, options.operations),
    state: parseEquipmentState(params.state),
  };
}

function queryOf(data: Data, params: Params, tab: FleetTab, archived: boolean): FleetQuery {
  return tab === "equipment" ? { tab, archived, ...filtersOf(data, params) } : { tab, archived };
}

function countsOf(data: Data): Record<FleetTab, number> {
  return { equipment: data.equipment.length, suppliers: data.suppliers.length, "asset-types": data.assetTypes.length };
}

function Body({ data, params, tab, archived, ...access }: Access & { data: Data; params: Params; tab: FleetTab; archived: boolean }) {
  const query = queryOf(data, params, tab, archived);
  return (
    <>
      {data.wide && <FleetTabs active={tab} archived={archived} counts={countsOf(data)} />}
      {tab === "suppliers" && <SuppliersPanel data={data} query={query} {...access} />}
      {tab === "asset-types" && <AssetTypesPanel data={data} query={query} {...access} />}
      {tab === "equipment" && <EquipmentPanel data={data} query={query} params={params} {...access} />}
    </>
  );
}

/** The page is for any catalog reader; what each one may do is decided by tenant-wide permissions. */
function accessOf(context: ActorContext, actor: Actor) {
  const { accessPolicy } = getContainer();
  const position = { tenantId: actor.tenantId };
  return {
    wide: canViewFleetCatalogs(context),
    canArchive: accessPolicy.check(actor, "catalog.archive", position).ok,
    canWrite: accessPolicy.check(actor, "catalog.write", position).ok,
  };
}

export default async function FleetPage({ searchParams }: { readonly searchParams: Promise<Params> }) {
  const context = await requireActor();
  if (!canViewFleet(context)) return <Restricted />;
  const actor = toActor(context);
  const { wide, canArchive, canWrite } = accessOf(context, actor);
  const params = await searchParams;
  const archived = canArchive && wantsArchived(params.archived);
  const data = await loadFleet(actor, archived, wide);
  if (data === null) return <Restricted />;
  const tab = wide ? parseFleetTab(params.tab) : "equipment";
  return (
    <>
      <Header data={data} canWrite={canWrite} canArchive={canArchive} tab={tab} />
      <Body data={data} params={params} tab={tab} archived={archived} canWrite={canWrite} canArchive={canArchive} />
    </>
  );
}
