import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { toActor } from "../../../../../src/identity/application/actor-mapper";
import type { ActorContext } from "../../../../../src/identity/application/actor-context";
import type { EquipmentListItem } from "../../../../../src/fleet/application/equipment-visibility";
import type { EquipmentReadings } from "../../../../../src/metering/application/use-cases/list-equipment-readings";
import { dayOf } from "../../../../../src/fleet/domain/day";
import type { Operation } from "../../../../../src/organization/domain/entities";
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
  hasHeaderButtons,
  correctionOperations,
  incomingCandidates,
  parseDetailTab,
  writableOperations,
  type DetailActions,
  type DetailPlaces,
  type DetailTab,
} from "../../../../_lib/equipment-detail-view";
import { buildReadingsView, lastReadingRow, readingActions } from "../../../../_lib/readings-view";
import { assetTypeOptions, buildEquipmentRows, equipmentImageUrl, listOrEmpty, supplierOptions } from "../../../../_lib/fleet-view";
import { requireActor } from "../../../../_lib/session";
import { EditEquipmentDialog, type EquipmentOptions } from "../../equipment-dialogs";
import { ArchiveDialog } from "../../fleet-dialogs";
import {
  archiveEquipmentFromDetailAction,
  restoreEquipmentFromDetailAction,
  updateEquipmentFromDetailAction,
} from "./actions";
import { AssignDialog, EndDialog, MoveDialog, ReplaceDialog } from "./assignment-dialogs";
import { InfoCard, LocationCard, MoreCard } from "./detail-cards";
import { HistoryPanel } from "./history-table";
import { ReadingsPanel } from "./readings-panel";

export const metadata = { title: copy.fleet.detail.pageTitle };

const t = copy.fleet.detail;

type Props = {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{ readonly tab?: string | readonly string[] }>;
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
  return { places, operations: listOrEmpty(operations) };
}

type ActionData = {
  readonly today: string;
  readonly moveTo: readonly Option[];
  readonly assignTo: readonly Option[];
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

async function loadActionData(actor: Actor, item: EquipmentListItem, actions: DetailActions, operations: readonly Operation[]): Promise<ActionData> {
  const assignTo = writableOperations(operations, writeAt(actor));
  return {
    today: dayOf(new Date()),
    assignTo,
    moveTo: assignTo.filter((op) => op.id !== item.assignment?.operationId),
    ...(await loadChoices(actor, item, actions)),
  };
}

type ButtonsProps = { item: EquipmentListItem; actions: DetailActions; data: ActionData; canArchive: boolean };

function AssignmentButtons({ item, actions, data, canArchive }: ButtonsProps) {
  const target = { id: item.id, code: item.internalCode };
  return (
    <>
      {actions.assign && <AssignDialog target={target} today={data.today} operations={data.assignTo} />}
      {actions.move && <MoveDialog target={target} today={data.today} operations={data.moveTo} />}
      {actions.replace && <ReplaceDialog target={target} today={data.today} candidates={data.candidates} canArchive={canArchive} />}
      {actions.end && <EndDialog target={target} today={data.today} />}
    </>
  );
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

function ActionButtons(props: ButtonsProps & { places: DetailPlaces }) {
  if (!hasHeaderButtons(props.actions)) return null;
  return (
    <span className="head-actions" role="group" aria-label={t.actionsLabel}>
      <AssignmentButtons {...props} />
      <CatalogButtons {...props} />
    </span>
  );
}

function Header({ item, buttons }: { item: EquipmentListItem; buttons: ReactNode }) {
  const state = detailState(item);
  return (
    <>
      <a className="back-link" href="/fleet">{t.back}</a>
      <header className="page-head">
        <div>
          <div className="title-row">
            <h1>{t.title(item.internalCode)}</h1>
            <span className={`badge badge-${state.tone}`}>{state.label}</span>
          </div>
          <p className="page-sub">{item.assetType.name}</p>
        </div>
        {buttons}
      </header>
    </>
  );
}

function Tabs({ id, active }: { id: string; active: DetailTab }) {
  const base = `/fleet/equipment/${id}`;
  const tabs: readonly (readonly [DetailTab, string, string])[] = [
    ["info", t.tabs.info, base],
    ["history", t.tabs.history, `${base}?tab=history`],
    ["readings", t.tabs.readings, `${base}?tab=readings`],
  ];
  return (
    <nav className="tabs" aria-label={t.tabsLabel}>
      {tabs.map(([tab, label, href]) => (
        <a key={tab} className="tab" href={href} aria-current={tab === active ? "page" : undefined}>{label}</a>
      ))}
    </nav>
  );
}

type HistoryProps = { item: EquipmentListItem; actor: Actor; places: DetailPlaces; canWrite: boolean; data: ActionData };

async function History({ item, actor, places, canWrite, data }: HistoryProps) {
  const listed = await getContainer().fleet.listEquipmentAssignments.execute({ actor, equipmentId: item.id });
  const rows = buildHistoryRows(listOrEmpty(listed), places);
  const operationsFor = (row: { form: { operationId: string } }) => correctionOperations(data.assignTo, row.form.operationId, places.operations);
  return (
    <section className="card section-card tab-panel" aria-label={t.history.title}>
      <HistoryPanel equipmentId={item.id} rows={rows} canCorrect={canWrite} operationsFor={operationsFor} />
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
async function loadReadings(actor: Actor, id: string): Promise<EquipmentReadings | null> {
  const listed = await getContainer().metering.listEquipmentReadings.execute({ actor, equipmentId: id });
  return listed.ok ? listed.value : null;
}

/** Display names by user id; only an actor allowed to list users gets them, the others see a dash. */
async function loadNames(context: ActorContext): Promise<ReadonlyMap<string, string>> {
  const listed = await getContainer().identity.listUsers.execute({ actor: context });
  return new Map(listed.ok ? listed.value.map((user) => [user.id, user.displayName] as const) : []);
}

/** `reading.write` and `reading.correct` at the position of the open assignment (or the company without one). */
const readingAccessOf = (actor: Actor, item: EquipmentListItem, meterKind: EquipmentListItem["assetType"]["meterKind"]) => {
  const { accessPolicy } = getContainer();
  const open = item.assignment;
  const position = open === null
    ? { tenantId: actor.tenantId }
    : { tenantId: actor.tenantId, businessUnitId: open.businessUnitId, operationId: open.operationId, siteId: open.siteId };
  return {
    canWrite: accessPolicy.check(actor, "reading.write", position).ok,
    canCorrect: accessPolicy.check(actor, "reading.correct", position).ok,
    archived: item.archivedAt !== null,
    meterKind,
  };
};

type ReadingsTabProps = { item: EquipmentListItem; actor: Actor; context: ActorContext; today: string };

async function ReadingsTab({ item, actor, context, today }: ReadingsTabProps) {
  const readings = await loadReadings(actor, item.id);
  if (readings === null) notFound();
  const names = await loadNames(context);
  const who = { selfId: context.user.id, selfName: context.user.displayName, names };
  const actions = readingActions(readingAccessOf(actor, item, readings.meterKind), readings.meter !== null);
  const target = { id: item.id, code: item.internalCode };
  return <ReadingsPanel view={buildReadingsView(readings, who)} target={target} today={today} actions={actions} />;
}

export default async function EquipmentDetailPage({ params, searchParams }: Props) {
  const context = await requireActor();
  const actor = toActor(context);
  const item = await loadEquipment(actor, (await params).id);
  const tab = parseDetailTab((await searchParams).tab);
  const access = accessOf(actor);
  const actions = detailActions({ ...access, archived: item.archivedAt !== null, assigned: item.assignment !== null });
  const { places, operations } = await loadPlaces(actor);
  const data = await loadActionData(actor, item, actions, operations);
  const buttons = <ActionButtons item={item} actions={actions} data={data} places={places} canArchive={access.canArchive} />;
  return (
    <>
      <Header item={item} buttons={buttons} />
      <Tabs id={item.id} active={tab} />
      {tab === "info" && <InfoTab item={item} places={places} readings={await loadReadings(actor, item.id)} />}
      {tab === "history" && <History item={item} actor={actor} places={places} canWrite={access.canWrite} data={data} />}
      {tab === "readings" && <ReadingsTab item={item} actor={actor} context={context} today={data.today} />}
    </>
  );
}

function InfoTab({ item, places, readings }: { item: EquipmentListItem; places: DetailPlaces; readings: EquipmentReadings | null }) {
  const last = lastReadingRow(readings);
  return (
    <div className="detail-grid">
      <InfoCard rows={buildInfoRows(item, last === null ? [] : [last])} imageUrl={equipmentImageUrl(item.id, item.imageHash)} />
      <LocationCard view={buildLocation(item, places)} />
      <MoreCard />
    </div>
  );
}
