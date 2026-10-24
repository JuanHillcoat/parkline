import { field } from "./action-state";
import { optionalText } from "./fleet-form";

/** A day arrives as the text of `<input type="date">`; the use cases parse it, never a JS Date. */
const day = (form: FormData, name: string): string => field(form, name).trim();

/** The first assignment of an equipment. A blank reason is "not set": only a past day makes it mandatory. */
export const assignFields = (form: FormData) => ({
  equipmentId: field(form, "equipmentId"),
  operationId: field(form, "operationId"),
  kind: field(form, "kind"),
  day: day(form, "day"),
  reason: optionalText(field(form, "reason")),
});

export const moveFields = (form: FormData) => ({
  equipmentId: field(form, "equipmentId"),
  operationId: field(form, "operationId"),
  day: day(form, "day"),
  reason: field(form, "reason"),
});

/**
 * The choice for the outgoing equipment is sent exactly as the form carries it. A missing or unknown value
 * stays `undefined`, so the use case answers `outgoing_required`: there is no default that skips the choice.
 */
const outgoingChoice = (raw: string): "spare" | "retire" | undefined => (raw === "spare" || raw === "retire" ? raw : undefined);

/** The `equipmentId` of the form is the equipment being replaced: the page the dialog was opened from. */
export const replaceFields = (form: FormData) => ({
  outgoingEquipmentId: field(form, "equipmentId"),
  incomingEquipmentId: field(form, "incomingEquipmentId"),
  day: day(form, "day"),
  outgoing: outgoingChoice(field(form, "outgoing")),
  reason: field(form, "reason"),
});

export const endFields = (form: FormData) => ({
  equipmentId: field(form, "equipmentId"),
  day: day(form, "day"),
  reason: field(form, "reason"),
});

/** An empty end means the assignment is open again (`null`); the other fields are always sent. */
export const correctFields = (form: FormData) => ({
  assignmentId: field(form, "assignmentId"),
  validFrom: day(form, "validFrom"),
  validTo: optionalText(field(form, "validTo")) === null ? null : day(form, "validTo"),
  operationId: field(form, "operationId"),
  kind: field(form, "kind"),
  reason: field(form, "reason"),
});
