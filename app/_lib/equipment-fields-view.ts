import { BATTERY_KINDS, type MeterKind } from "../../src/fleet/domain/values";
import { copy } from "./copy";
import type { Option } from "./fleet-view";

/** The value of the "Operación" select that means "a spare of a site": the Site select then shows. */
export const MULETO = "muleto";

/** Where an equipment is placed in a form: an operation, or a site as a spare. Blank means nothing chosen. */
export type PlacementValues = { readonly operationId: string; readonly siteId: string };

export const NO_PLACEMENT: PlacementValues = { operationId: "", siteId: "" };

/** The battery kinds, with their Spanish names, in the order of the domain. */
export const batteryKindOptions = (): Option[] =>
  BATTERY_KINDS.map((id) => ({ id, name: copy.fleet.batteryKind[id] }));

/** The quantity of batteries exists only for lead acid: for lithium and combustion the field is not even shown. */
export const showsBatteryQuantity = (batteryKind: string): boolean => batteryKind === "lead_acid";

/** The label of the first reading field: Horómetro or Kilometraje by the meter; null when the type has no meter. */
export const readingFieldLabel = (meter: MeterKind): string | null =>
  meter === "none" ? null : copy.dialogs.newEquipment.readingLabel[meter];

/** What the "Operación" select shows first: Muleto for a site, else the operation (blank when none). */
export const placementChoice = (placement: PlacementValues): string => (placement.siteId === "" ? placement.operationId : MULETO);

export const isMuleto = (choice: string): boolean => choice === MULETO;

/** The `operationId` that travels: the chosen operation, never the Muleto marker. */
export const operationOfChoice = (choice: string): string => (isMuleto(choice) ? "" : choice);

/** Whether the select offers Muleto: only when there is a site to hold the spare. */
export const offersMuleto = (sites: readonly Option[]): boolean => sites.length > 0;
