import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { toActor } from "../../../../../src/identity/application/actor-mapper";
import type { ActorContext } from "../../../../../src/identity/application/actor-context";
import type { EquipmentListItem } from "../../../../../src/fleet/application/equipment-visibility";
import type { EquipmentReadings } from "../../../../../src/metering/application/use-cases/list-equipment-readings";
import { dayOf } from "../../../../../src/fleet/domain/day";
import type { Operation, Site } from "../../../../../src/organization/domain/entities";
import type { Actor } from "../../../../../src/shared/domain/ports/access-policy";
import { ok, type Result } from "../../../../../src/shared/domain/result";
import { getContainer } from "../../../../../src/shared/infrastructure/container";
import type { Option } from "../../../../_components/form-fields";
import { copy } from "../../../../_lib/copy";
import {
  buildHistoryRows,
  buildInfoRows,
  buildLocation,
  detailActions,
  detailState,
  hasMenuActions,
  correctionOperations,
  correctionSites,
  incomingCandidates,
  moveOperations,
  moveSites,
  parseDetailTab,
  positionOfPlacement,
  writableOperations,
  writableSites,
  type DetailActions,
  type DetailPlaces,
  type DetailTab,
} from "../../../../_lib/equipment-detail-view";
import { buildMaintenanceView, formatCycle, maintenanceInput } from "../../../../_lib/equipment-maintenance-view";
import { buildReadingsView, readingActions } from "../../../../_lib/readings-view";
import { assetTypeOptions, buildEquipmentRows, equipmentImageUrl, listOrEmpty, supplierOptions } from "../../../../_lib/fleet-view";
import { requireActor } from "../../../../_lib/session";
import { buildUsageChart, REFERENCE_CONTRACTED_HOURS } from "../../../../_lib/usage-chart-view";
import { parsePeriod, periodOptions, periodValue, type Period } from "../../../../_lib/usage-period";
import { EditEquipmentDialog, type EquipmentOptions } from "../../equipment-dialogs";
import { ArchiveDialog } from "../../fleet-dialogs";
import {
  archiveEquipmentFromDetailAction,
  restoreEquipmentFromDetailAction,
  updateEquipmentFromDetailAction,
} from "./actions";
import { ComingSoonButtons } from "./coming-soon";
import { AssignDialog, EndDialog, MoveDialog, ReplaceDialog } from "./assignment-dialogs";
import { InfoCard, LocationCard, MaintenanceCard, ObservationsCard } from "./detail-cards";
import { HistoryPanel } from "./history-table";
import { MoreMenu } from "./more-menu";
import { RecordReadingDialog } from "./reading-dialogs";
import { ReadingsPanel } from "./readings-panel";
import { UsageCard, UsageCardEmpty } from "./usage-chart";

export const metadata = { title: copy.fleet.detail.pageTitle };

const t = copy.fleet.detail;

type Props = {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly tab?: string | readonly string[]; readonly period?: string | readonly string[] }>;
};

type Skipped<T> = Promise<Result<readonly T[], unknown>>;
const when = <T,>(wanted: boolean, run: () => Skipped<T>): Skipped<T> => (wanted ? run() : Promise.resolve(ok([])));

/** The names of the places the actor can read; a name it cannot read shows as a dash. */
async function loadPlaces(actor: Actor) {
  const { organization } = getContainer();
  const [operations, sites, divisions] = await Promise.all([
    organization.listOperations.execute({ actor }),
    organization.listSites.execute({ actor }),
    organization.listBusinessUnits.execute({ actor }),
  ]);
  const places: DetailPlaces = { operations: listOrEmpty(operations), sites: listOrEmpty(sites), divisions: listOrEmpty(divisions) };
  return { places, operations: listOrEmpty(operations), sites: listOrEmpty(sites) };
}

type ActionData = {
  readonly today: string;
  readonly moveTo: readonly Option[];
  readonly assignTo: readonly Option[];
  /** The sites that can hold a spare (the actor writes at them) and those a move can still go to. */
  readonly spareAt: readonly Option[];
  readonly moveSpareAt: readonly Option[];
  readonly candidates: readonly Option[];
  readonly options: EquipmentOptions;
};

type Place = { readonly id: string; readonly businessUnitId: string; readonly siteId: string };

/** Whether the actor holds `catalog.write` at the position of an operation. */
const writeAt = (actor: Actor) => (op: Place): boolean =>
  getContainer().accessPolicy.check(actor, "catalog.write", {
    tenantId: actor.tenantId,
    businessUnitId: op.businessUnitId,
    operationId: op.id,
    siteId: op.siteId,
  }).ok;

/** Whether the actor holds `catalog.write` at the position of a site, where a spare lives (no division, no operation). */
const writeAtSite = (actor: Actor) => (site: { readonly id: string }): boolean =>
  getContainer().accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId, siteId: site.id }).ok;

/** The catalogs of the edit dialog and the free equipment of the replace dialog, read only when those buttons show. */
async function loadChoices(actor: Actor, item: EquipmentListItem, actions: DetailActions) {
  const { fleet } = getContainer();
  const [suppliers, types, equipment] = await Promise.all([
    when(actions.edit, () => fleet.listSuppliers.execute({ actor })),
    when(actions.edit, () => fleet.listAssetTypes.execute({ actor })),
    when(actions.replace, () => fleet.listEquipment.execute({ actor })),
  ]);
  return {
    candidates: incomingCandidates(listOrEmpty(equipment), item.id),
    options: { suppliers: supplierOptions(listOrEmpty(suppliers)), assetTypes: assetTypeOptions(listOrEmpty(types)) },
  };
}

type Places = { readonly operations: readonly Operation[]; readonly sites: readonly Site[] };

async function loadActionData(actor: Actor, item: EquipmentListItem, actions: DetailActions, places: Places): Promise<ActionData> {
  const assignTo = writableOperations(places.operations, writeAt(actor));
  const spareAt = writableSites(places.sites, writeAtSite(actor));
  return {
    today: dayOf(new Date()),
    assignTo,
    moveTo: moveOperations(assignTo, item.assignment),
    spareAt,
    moveSpareAt: moveSites(spareAt, item.assignment),
    ...(await loadChoices(actor, item, actions)),
  };
}

type ButtonsProps = { item: EquipmentListItem; actions: DetailActions; data: ActionData; canArchive: boolean };

/** The place button of the location card: Asignar for an unassigned equipment, Cambiar operación / sitio for an assigned one. */
function LocationAction({ item, actions, data }: ButtonsProps) {
  const target = { id: item.id, code: item.internalCode };
  const className = "btn btn-block btn-tone btn-blue btn-icon-swap";
  if (actions.assign) return <AssignDialog target={target} today={data.today} operations={data.assignTo} sites={data.spareAt} triggerClassName={className} />;
  if (actions.move) return <MoveDialog target={target} today={data.today} operations={data.moveTo} sites={data.moveSpareAt} triggerClassName={className} />;
  return null;
}

/** The edit, archive and restore buttons are the board's own dialogs, wired to actions that refresh this page. */
function CatalogButtons({ item, actions, data, places }: ButtonsProps & { places: DetailPlaces }) {
  const row = buildEquipmentRows([item], places)[0];
  const target = { id: item.id, name: item.internalCode };
  return (
    <>
      {actions.edit && row !== undefined && (
        <EditEquipmentDialog target={row} options={data.options} triggerClassName="btn" action={updateEquipmentFromDetailAction} />
      )}
      {actions.archive && <ArchiveDialog kind="equipment" verb="archive" target={target} triggerClassName="btn" action={archiveEquipmentFromDetailAction} />}
      {actions.restore && <ArchiveDialog kind="equipment" verb="restore" target={target} triggerClassName="btn" action={restoreEquipmentFromDetailAction} />}
    </>
  );
}

/** The "Más acciones" menu: replace, end, edit, archive and restore, each gated as before. */
function ActionMenu(props: ButtonsProps & { places: DetailPlaces }) {
  const { item, actions, data, canArchive } = props;
  if (!hasMenuActions(actions)) return null;
  const target = { id: item.id, code: item.internalCode };
  return (
    <MoreMenu label={t.moreActions} groupLabel={t.actionsLabel}>
      {actions.replace && <ReplaceDialog target={target} today={data.today} candidates={data.candidates} canArchive={canArchive} />}
      {actions.end && <EndDialog target={target} today={data.today} />}
      <CatalogButtons {...props} />
    </MoreMenu>
  );
}

/** `reading.write` and `reading.correct` at the position of the open assignment (or the company without one). */
const readingAccessOf = (actor: Actor, item: EquipmentListItem, meterKind: EquipmentListItem["assetType"]["meterKind"]) => {
  const { accessPolicy } = getContainer();
  const position = positionOfPlacement(actor.tenantId, item.assignment);
  return {
    canWrite: accessPolicy.check(actor, "reading.write", position).ok,
    canCorrect: accessPolicy.check(actor, "reading.correct", position).ok,
    archived: item.archivedAt !== null,
    meterKind,
  };
};

type RecordProps = { item: EquipmentListItem; actor: Actor; readings: EquipmentReadings | null; today: string };

/** "Registrar horas" (or km): the gate the Lecturas tab had, `reading.write` at the position of the equipment. */
function RecordButton({ item, actor, readings, today }: RecordProps) {
  const meterKind = readings?.meterKind ?? item.assetType.meterKind;
  const allowed = readingActions(readingAccessOf(actor, item, meterKind), (readings?.meter ?? null) !== null).load;
  if (!allowed || meterKind === "none") return null;
  return <RecordReadingDialog target={{ id: item.id, code: item.internalCode }} today={today} unit={meterKind} />;
}

function Header({ item, children }: { item: EquipmentListItem; children: ReactNode }) {
  const state = detailState(item);
  return (
    <header className="page-head">
      <div className="title-row">
        <h1>
          {t.titleCode(item.internalCode)}
          <span className="title-type">{t.titleType(item.assetType.name)}</span>
        </h1>
        <span className={`badge badge-${state.tone} badge-square`}>{state.label}</span>
      </div>
      {children}
    </header>
  );
}

function Tabs({ id, active }: { id: string; active: DetailTab }) {
  const base = `/fleet/equipment/${id}`;
  const tabs: readonly (readonly [DetailTab, string])[] = [
    ["history", t.tabs.history],
    ["readings", t.tabs.readings],
  ];
  return (
    <nav className="tabs" aria-label={t.tabsLabel}>
      {tabs.map(([tab, label]) => (
        <a key={tab} className="tab" href={`${base}?tab=${tab}`} aria-current={tab === active ? "page" : undefined}>{label}</a>
      ))}
    </nav>
  );
}

type HistoryProps = { item: EquipmentListItem; actor: Actor; places: DetailPlaces; canWrite: boolean; data: ActionData };

async function History({ item, actor, places, canWrite, data }: HistoryProps) {
  const listed = await getContainer().fleet.listEquipmentAssignments.execute({ actor, equipmentId: item.id });
  const rows = buildHistoryRows(listOrEmpty(listed), places);
  const operationsFor = (row: { form: { operationId: string } }) => correctionOperations(data.assignTo, row.form.operationId, places.operations);
  const sitesFor = (row: { form: { siteId: string } }) => correctionSites(data.spareAt, row.form.siteId, places.sites);
  return (
    <section className="card section-card tab-panel" aria-label={t.history.title}>
      <HistoryPanel equipmentId={item.id} rows={rows} canCorrect={canWrite} operationsFor={operationsFor} sitesFor={sitesFor} />
    </section>
  );
}

const accessOf = (actor: Actor) => {
  const { accessPolicy } = getContainer();
  const position = { tenantId: actor.tenantId };
  return {
    canArchive: accessPolicy.check(actor, "catalog.archive", position).ok,
    canWrite: accessPolicy.check(actor, "catalog.write", position).ok,
  };
};

/** A missing equipment and one the actor may not see answer the same: the app's not-found page. */
async function loadEquipment(actor: Actor, id: string): Promise<EquipmentListItem> {
  const found = await getContainer().fleet.getEquipment.execute({ actor, id });
  if (!found.ok) notFound();
  return found.value;
}

/** The readings of the equipment, or null when the actor cannot read them (the page then shows no reading data). */
async function loadReadings(actor: Actor, id: string, year: number): Promise<EquipmentReadings | null> {
  const listed = await getContainer().metering.listEquipmentReadings.execute({ actor, equipmentId: id, year });
  return listed.ok ? listed.value : null;
}

/** Display names by user id; only an actor allowed to list users gets them, the others see a dash. */
async function loadNames(context: ActorContext): Promise<ReadonlyMap<string, string>> {
  const listed = await getContainer().identity.listUsers.execute({ actor: context });
  return new Map(listed.ok ? listed.value.map((user) => [user.id, user.displayName] as const) : []);
}

type ReadingsTabProps = { item: EquipmentListItem; actor: Actor; context: ActorContext; today: string; readings: EquipmentReadings | null };

async function ReadingsTab({ item, actor, context, today, readings }: ReadingsTabProps) {
  if (readings === null) notFound();
  const names = await loadNames(context);
  const who = { selfId: context.user.id, selfName: context.user.displayName, names };
  const actions = readingActions(readingAccessOf(actor, item, readings.meterKind), readings.meter !== null);
  const target = { id: item.id, code: item.internalCode };
  return <ReadingsPanel view={buildReadingsView(readings, who)} target={target} today={today} actions={actions} />;
}

type UsageProps = { readings: EquipmentReadings | null; period: Period; today: string; tab: DetailTab };

/** The chart of the chosen year up to the chosen month, or a note when the asset type has no meter. */
function Usage({ readings, period, today, tab }: UsageProps) {
  const filter = { options: periodOptions(today), value: periodValue(period), tab: tab === "readings" ? tab : null };
  if (readings === null || readings.meterKind === "none") return <UsageCardEmpty filter={filter} />;
  const unit = readings.meterKind;
  const shown = readings.monthlyTotals.slice(0, period.month);
  const chart = buildUsageChart(shown, unit === "hours" ? REFERENCE_CONTRACTED_HOURS : null);
  return <UsageCard chart={chart} unit={unit} year={period.year} values={shown.map((total) => formatCycle(total, unit))} filter={filter} />;
}

type HeaderActionsProps = { buttons: ButtonsProps; places: DetailPlaces; actor: Actor; readings: EquipmentReadings | null };

/** Registrar horas, the three buttons still to come and the Más acciones menu; a reader sees none of them. */
function HeaderActions({ buttons, places, actor, readings }: HeaderActionsProps) {
  return (
    <span className="head-actions">
      <RecordButton item={buttons.item} actor={actor} readings={readings} today={buttons.data.today} />
      {buttons.actions.edit && <ComingSoonButtons />}
      <ActionMenu {...buttons} places={places} />
    </span>
  );
}

type DetailView = { buttons: ButtonsProps; places: DetailPlaces; readings: EquipmentReadings | null; period: Period; tab: DetailTab };

/** The four cards of the top row (issue 60 D2). The month hours follow the period the filter picked. */
function Cards({ buttons, places, readings, period, tab }: DetailView) {
  const { item, data } = buttons;
  const monthHours = readings?.monthlyTotals[period.month - 1];
  return (
    <div className="detail-grid">
      <InfoCard rows={buildInfoRows(item)} imageUrl={equipmentImageUrl(item.id, item.imageHash)} />
      <LocationCard view={buildLocation(item, places)} action={<LocationAction {...buttons} />} />
      <MaintenanceCard view={buildMaintenanceView(maintenanceInput(item, readings, monthHours))} />
      <Usage readings={readings} period={period} today={data.today} tab={tab} />
    </div>
  );
}

type DetailProps = { item: EquipmentListItem; actor: Actor; context: ActorContext; tab: DetailTab; period: Period };

async function Detail({ item, actor, context, tab, period }: DetailProps) {
  const access = accessOf(actor);
  const actions = detailActions({ ...access, archived: item.archivedAt !== null, assigned: item.assignment !== null });
  const { places, operations, sites } = await loadPlaces(actor);
  const data = await loadActionData(actor, item, actions, { operations, sites });
  const readings = await loadReadings(actor, item.id, period.year);
  const buttons = { item, actions, data, canArchive: access.canArchive };
  return (
    <>
      <Header item={item}>
        <HeaderActions buttons={buttons} places={places} actor={actor} readings={readings} />
      </Header>
      <Cards buttons={buttons} places={places} readings={readings} period={period} tab={tab} />
      <Tabs id={item.id} active={tab} />
      {tab === "history" && <History item={item} actor={actor} places={places} canWrite={access.canWrite} data={data} />}
      {tab === "readings" && <ReadingsTab item={item} actor={actor} context={context} today={data.today} readings={readings} />}
      <ObservationsCard text={item.observations} />
    </>
  );
}

export default async function EquipmentDetailPage({ params, searchParams }: Props) {
  const context = await requireActor();
  const actor = toActor(context);
  const item = await loadEquipment(actor, (await params).id);
  const query = await searchParams;
  const period = parsePeriod(query.period, dayOf(new Date()));
  return <Detail item={item} actor={actor} context={context} tab={parseDetailTab(query.tab)} period={period} />;
}
