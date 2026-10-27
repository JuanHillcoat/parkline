import type { EquipmentListItem } from "../../src/fleet/application/equipment-visibility";
import type { Assignment, AssignmentKind } from "../../src/fleet/domain/assignment";
import { copy } from "./copy";
import type { Option, Places } from "./fleet-view";

const t = copy.fleet.detail;
const NONE = copy.fleet.noValue;

type Raw = string | readonly string[] | undefined;

export type DetailTab = "info" | "history" | "readings";

/** An unknown or repeated tab value falls back to the information tab. */
export const parseDetailTab = (raw: Raw): DetailTab => (raw === "history" || raw === "readings" ? raw : "info");

/** `YYYY-MM-DD` as `DD/MM/YYYY`, by splitting the text: a day never goes through Date (no timezone). */
export const formatDay = (day: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  return match === null ? day : `${match[3] ?? ""}/${match[2] ?? ""}/${match[1] ?? ""}`;
};

export type InfoRow = { readonly label: string; readonly value: string };
export type DetailPlaces = Places & { readonly divisions: readonly Option[] };

const orDash = (value: string | number | null | undefined): string => value?.toString() ?? NONE;
const nameOf = (options: readonly Option[], id: string | null): string => options.find((option) => option.id === id)?.name ?? NONE;

/** The kind of battery (a dash for an old row without one) and, for lead acid only, how many there are. */
const batteryRows = (item: EquipmentListItem): InfoRow[] => [
  { label: t.info.batteryKind, value: item.batteryKind === null ? NONE : copy.fleet.batteryKind[item.batteryKind] },
  ...(item.batteryKind === "lead_acid" ? [{ label: t.info.batteries, value: orDash(item.batteryQuantity) }] : []),
];

/** The general information card: every field of the equipment, with a dash where it is blank. `extra` rows (the last reading) go last. */
export const buildInfoRows = (item: EquipmentListItem, extra: readonly InfoRow[] = []): InfoRow[] => [
  { label: t.info.internalCode, value: item.internalCode },
  { label: t.info.assetType, value: item.assetType.name },
  { label: t.info.supplier, value: item.supplier.name },
  { label: t.info.brand, value: orDash(item.brand) },
  { label: t.info.model, value: orDash(item.model) },
  { label: t.info.year, value: orDash(item.year) },
  { label: t.info.serialNumber, value: orDash(item.serialNumber) },
  ...batteryRows(item),
  { label: t.info.observations, value: orDash(item.observations) },
  ...extra,
];

export type LocationView = { readonly assigned: boolean; readonly rows: InfoRow[]; readonly hint: string | null };

type OpenAssignment = NonNullable<EquipmentListItem["assignment"]>;

/** A spare of a site has no operation and no division, so those rows are not shown for it. */
const locationRows = (open: OpenAssignment, places: DetailPlaces): InfoRow[] => [
  ...(open.operationId === null ? [] : [{ label: t.location.operation, value: nameOf(places.operations, open.operationId) }]),
  { label: t.location.site, value: nameOf(places.sites, open.siteId) },
  ...(open.businessUnitId === null ? [] : [{ label: t.location.division, value: nameOf(places.divisions, open.businessUnitId) }]),
  { label: t.location.kind, value: t.kinds[open.kind] },
  { label: t.location.since, value: formatDay(open.validFrom) },
];

/** The current location card: names come from the organization lists; a name the actor cannot read is a dash. */
export const buildLocation = (item: EquipmentListItem, places: DetailPlaces): LocationView => {
  const open = item.assignment;
  if (open === null) {
    return { assigned: false, rows: [], hint: item.archivedAt === null ? t.location.noneHint : t.location.noneHintArchived };
  }
  return { assigned: true, hint: null, rows: locationRows(open, places) };
};

export type StatePill = { readonly label: string; readonly tone: "ok" | "warn" | "neutral" };

/** The pill beside the title: De baja wins over the kind of the open assignment, which an archived equipment lacks. */
export const detailState = (item: EquipmentListItem): StatePill => {
  if (item.archivedAt !== null) return { label: copy.common.archivedTag, tone: "neutral" };
  if (item.assignment === null) return { label: copy.fleet.state.unassigned, tone: "neutral" };
  return item.assignment.kind === "spare"
    ? { label: copy.fleet.state.spare, tone: "warn" }
    : { label: copy.fleet.state.active, tone: "ok" };
};

/**
 * What the correction dialog shows first: the days as text (an open end is empty) and the place, which is an
 * operation or, for a spare of a site, that site (the operation is then blank).
 */
export type CorrectionValues = {
  readonly validFrom: string;
  readonly validTo: string;
  readonly operationId: string;
  readonly siteId: string;
  readonly kind: AssignmentKind;
};

export type HistoryRow = {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly open: boolean;
  readonly operationName: string;
  readonly siteName: string;
  readonly kindLabel: string;
  readonly reason: string;
  readonly form: CorrectionValues;
};

const historyRow = (assignment: Assignment, places: DetailPlaces): HistoryRow => ({
  id: assignment.id,
  from: formatDay(assignment.validFrom),
  to: assignment.validTo === null ? t.history.open : formatDay(assignment.validTo),
  open: assignment.validTo === null,
  operationName: nameOf(places.operations, assignment.operationId),
  siteName: nameOf(places.sites, assignment.siteId),
  kindLabel: t.kinds[assignment.kind],
  reason: orDash(assignment.reason),
  form: {
    validFrom: assignment.validFrom,
    validTo: assignment.validTo ?? "",
    operationId: assignment.operationId ?? "",
    siteId: assignment.operationId === null ? assignment.siteId : "",
    kind: assignment.kind,
  },
});

/** The timeline in the order given (the use case returns the newest first). */
export const buildHistoryRows = (assignments: readonly Assignment[], places: DetailPlaces): HistoryRow[] =>
  assignments.map((assignment) => historyRow(assignment, places));

export type DetailActions = {
  readonly assign: boolean;
  readonly move: boolean;
  readonly replace: boolean;
  readonly end: boolean;
  readonly edit: boolean;
  readonly archive: boolean;
  readonly restore: boolean;
  readonly correct: boolean;
};

type ActionContext = { readonly canWrite: boolean; readonly canArchive: boolean; readonly archived: boolean; readonly assigned: boolean };

/**
 * The buttons that make sense now for this actor. The server actions enforce the permissions again; an
 * equipment with an open assignment cannot be archived, and an archived one cannot be assigned or edited.
 */
export const detailActions = ({ canWrite, canArchive, archived, assigned }: ActionContext): DetailActions => {
  const live = canWrite && !archived;
  return {
    assign: live && !assigned,
    move: live && assigned,
    replace: live && assigned,
    end: live && assigned,
    edit: live,
    archive: canArchive && !archived && !assigned,
    restore: canArchive && archived,
    correct: canWrite,
  };
};

/** Whether the header has any button to show (corrections live in the history, not in the header). */
export const hasHeaderButtons = (actions: DetailActions): boolean =>
  actions.assign || actions.move || actions.replace || actions.end || actions.edit || actions.archive || actions.restore;

export type OutgoingChoice = "spare" | "retire";

/** The muleto is preselected: the baja is a real-world fact the system cannot know (D5). */
export const OUTGOING_DEFAULT: OutgoingChoice = "spare";

/** The baja is offered only to an actor who may archive. */
export const outgoingChoices = (canArchive: boolean): readonly OutgoingChoice[] => (canArchive ? ["spare", "retire"] : ["spare"]);

/** Equipment that can come in as a replacement: active, with no open assignment, other than the outgoing one. */
export const incomingCandidates = (items: readonly EquipmentListItem[], outgoingId: string): Option[] =>
  items
    .filter((item) => item.id !== outgoingId && item.archivedAt === null && item.assignment === null)
    .map((item) => ({ id: item.id, name: `${item.internalCode} - ${item.assetType.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));

type OperationRow = Option & { readonly businessUnitId: string; readonly siteId: string; readonly archivedAt: Date | null };
type SiteRow = Option & { readonly archivedAt: Date | null };

/** Active operations where the actor may write: the choices of the assign and move dialogs. */
export const writableOperations = (operations: readonly OperationRow[], canWriteAt: (operation: OperationRow) => boolean): Option[] =>
  operations.filter((operation) => operation.archivedAt === null && canWriteAt(operation)).map(({ id, name }) => ({ id, name }));

/** Active sites where the actor may write (a spare belongs to a site): the Site choices of the dialogs. */
export const writableSites = (sites: readonly SiteRow[], canWriteAt: (site: SiteRow) => boolean): Option[] =>
  sites.filter((site) => site.archivedAt === null && canWriteAt(site)).map(({ id, name }) => ({ id, name }));

/** The site choices of the correction dialog always include the site the row is in, so it can stay selected. */
export const correctionSites = (choices: readonly Option[], currentId: string, known: readonly Option[]): Option[] =>
  currentId === "" || choices.some((choice) => choice.id === currentId) ? [...choices] : [...choices, { id: currentId, name: nameOf(known, currentId) }];

/** The site choices of the move dialog leave out the site where the equipment is already a spare (it would not move). */
export const moveSites = (choices: readonly Option[], open: OpenAssignment | null): Option[] =>
  choices.filter((choice) => !(open?.kind === "spare" && open.siteId === choice.id));

/** The operations of the move dialog leave out the operation where the equipment already is. */
export const moveOperations = (choices: readonly Option[], open: OpenAssignment | null): Option[] =>
  choices.filter((choice) => choice.id !== open?.operationId);

/** The choices of the correction dialog always include the operation the row is in, so it can stay selected. */
export const correctionOperations = (choices: readonly Option[], currentId: string, known: readonly Option[]): Option[] =>
  currentId === "" || choices.some((choice) => choice.id === currentId) ? [...choices] : [...choices, { id: currentId, name: nameOf(known, currentId) }];

type OpenPlacement = { readonly siteId: string; readonly businessUnitId: string | null; readonly operationId: string | null };

/**
 * The authorization position of an equipment: its open assignment, or the whole company without one. A spare
 * parked at a site has only the site (no division and no operation), so only company-wide grants match it.
 */
export const positionOfPlacement = (tenantId: string, open: OpenPlacement | null) =>
  open === null
    ? { tenantId }
    : {
        tenantId,
        siteId: open.siteId,
        ...(open.businessUnitId === null ? {} : { businessUnitId: open.businessUnitId }),
        ...(open.operationId === null ? {} : { operationId: open.operationId }),
      };
