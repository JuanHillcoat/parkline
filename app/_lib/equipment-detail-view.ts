import type { EquipmentListItem } from "../../src/fleet/application/equipment-visibility";
import type { Assignment, AssignmentKind } from "../../src/fleet/domain/assignment";
import { copy } from "./copy";
import type { Option, Places } from "./fleet-view";

const t = copy.fleet.detail;
const NONE = copy.fleet.noValue;

type Raw = string | readonly string[] | undefined;

export type DetailTab = "info" | "history";

/** An unknown or repeated tab value falls back to the information tab. */
export const parseDetailTab = (raw: Raw): DetailTab => (raw === "history" ? "history" : "info");

/** `YYYY-MM-DD` as `DD/MM/YYYY`, by splitting the text: a day never goes through Date (no timezone). */
export const formatDay = (day: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(day);
  return match === null ? day : `${match[3] ?? ""}/${match[2] ?? ""}/${match[1] ?? ""}`;
};

export type InfoRow = { readonly label: string; readonly value: string };
export type DetailPlaces = Places & { readonly divisions: readonly Option[] };

const orDash = (value: string | number | null | undefined): string => value?.toString() ?? NONE;
const nameOf = (options: readonly Option[], id: string): string => options.find((option) => option.id === id)?.name ?? NONE;

/** The general information card: every field of the equipment, with a dash where it is blank. */
export const buildInfoRows = (item: EquipmentListItem): InfoRow[] => [
  { label: t.info.internalCode, value: item.internalCode },
  { label: t.info.assetType, value: item.assetType.name },
  { label: t.info.supplier, value: item.supplier.name },
  { label: t.info.brand, value: orDash(item.brand) },
  { label: t.info.model, value: orDash(item.model) },
  { label: t.info.year, value: orDash(item.year) },
  { label: t.info.serialNumber, value: orDash(item.serialNumber) },
  { label: t.info.batteries, value: orDash(item.batteryQuantity) },
  { label: t.info.observations, value: orDash(item.observations) },
];

export type LocationView = { readonly assigned: boolean; readonly rows: InfoRow[]; readonly hint: string | null };

/** The current location card: names come from the organization lists; a name the actor cannot read is a dash. */
export const buildLocation = (item: EquipmentListItem, places: DetailPlaces): LocationView => {
  const open = item.assignment;
  if (open === null) {
    return { assigned: false, rows: [], hint: item.archivedAt === null ? t.location.noneHint : t.location.noneHintArchived };
  }
  return {
    assigned: true,
    hint: null,
    rows: [
      { label: t.location.operation, value: nameOf(places.operations, open.operationId) },
      { label: t.location.site, value: nameOf(places.sites, open.siteId) },
      { label: t.location.division, value: nameOf(places.divisions, open.businessUnitId) },
      { label: t.location.kind, value: t.kinds[open.kind] },
      { label: t.location.since, value: formatDay(open.validFrom) },
    ],
  };
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

/** What the correction dialog shows first: the days as text (an open end is empty), the operation and the kind. */
export type CorrectionValues = {
  readonly validFrom: string;
  readonly validTo: string;
  readonly operationId: string;
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
    operationId: assignment.operationId,
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

/** Active operations where the actor may write: the choices of the assign and move dialogs. */
export const writableOperations = (operations: readonly OperationRow[], canWriteAt: (operation: OperationRow) => boolean): Option[] =>
  operations.filter((operation) => operation.archivedAt === null && canWriteAt(operation)).map(({ id, name }) => ({ id, name }));

/** The choices of the correction dialog always include the operation the row is in, so it can stay selected. */
export const correctionOperations = (choices: readonly Option[], currentId: string, known: readonly Option[]): Option[] =>
  choices.some((choice) => choice.id === currentId) ? [...choices] : [...choices, { id: currentId, name: nameOf(known, currentId) }];
