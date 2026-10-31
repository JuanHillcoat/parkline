/**
 * Steps for the meter reading suites (issue 52): seed equipment with readings through the use cases, open and
 * submit the dialogs of the Lecturas tab the way a person does, and read back what was stored. Readers connect
 * as the owner of the ephemeral database, like the seeders do.
 */
import { titleOf } from "./detail-page";
import { expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { copy } from "../../app/_lib/copy";
import { openSeeder } from "./data";
import { openDialog, openDialogOf, skipBrowserValidation, submitDialog } from "./fleet-flows";
import { readWorld } from "./world";

export const r = copy.fleet.detail.readings;
export const rd = copy.dialogs;
export const messages = copy.errors.byCode;

/** The calendar day `offset` days from today, in UTC like the application's own clock. */
export const dayOffset = (offset: number): string => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
export const today = (): string => dayOffset(0);
export const ddmmyyyy = (iso: string): string => iso.split("-").reverse().join("/");

export const TYPES = { hours: "RDG HOURS", km: "RDG KM", none: "RDG NONE" } as const;
export const OTHER_OPERATION = "RDG OTHER OP";

export type Base = { readonly supplierId: string; readonly types: Record<keyof typeof TYPES, string>; readonly otherOperation: string };

/** One supplier, one asset type per meter kind and a second operation of the world's division (outside the supervisor's scope). */
export async function seedReadingsBase(): Promise<Base> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplierId = await seeder.supplier("Rdg supplier");
    const types = {
      hours: await seeder.assetType(TYPES.hours, "hours", 250),
      km: await seeder.assetType(TYPES.km, "km", 1000),
      none: await seeder.assetType(TYPES.none, "none"),
    };
    const otherOperation = await seeder.operation({ division: world.division, site: world.site, name: OTHER_OPERATION, costCenter: "7501" });
    return { supplierId, types, otherOperation };
  } finally {
    await seeder.close();
  }
}

export type UnitSeed = {
  readonly code: string;
  readonly type?: keyof typeof TYPES;
  /** `world` (default) puts it in the world's operation, which every scoped role reads; `other` in a second operation; `none` leaves it unassigned. */
  readonly place?: "world" | "other" | "none";
  /** Readings as [days from today, value], oldest first; the first one opens the meter. */
  readonly readings?: readonly (readonly [number, number])[];
  readonly archive?: boolean;
};

/** Seeds one equipment (and its readings) as the administrator and returns its id. */
export async function seedUnit(base: Base, unit: UnitSeed): Promise<string> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const id = await seeder.equipment({ supplierId: base.supplierId, assetTypeId: base.types[unit.type ?? "hours"], internalCode: unit.code });
    const place = unit.place ?? "world";
    if (place !== "none") await seeder.assign({ equipmentId: id, operationId: place === "world" ? world.operation : base.otherOperation });
    for (const [offset, value] of unit.readings ?? []) await seeder.reading(id, dayOffset(offset), value);
    if (unit.archive === true) await seeder.archiveEquipment(id, "Seeded as archived");
    return id;
  } finally {
    await seeder.close();
  }
}

/** Adds a reading behind the page's back (the stale form scenario). */
export async function seedReading(equipmentId: string, offset: number, value: number): Promise<void> {
  const seeder = await openSeeder();
  try {
    await seeder.reading(equipmentId, dayOffset(offset), value);
  } finally {
    await seeder.close();
  }
}

export async function gotoReadings(page: Page, id: string, code: string): Promise<void> {
  await page.goto(`/fleet/equipment/${id}?tab=readings`);
  await expect(page.getByRole("heading", { level: 1, name: titleOf(code) })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.fleet.detail.tabs.readings })).toHaveAttribute("aria-current", "page");
}

export const panelOf = (page: Page): Locator => page.getByRole("region", { name: r.title });
export const historyRows = (page: Page): Locator => page.getByRole("table", { name: r.caption }).locator("tbody tr");
export const toolbar = (page: Page): Locator => page.getByRole("group", { name: r.toolbar });
export { ringValue } from "./detail-page";
export const hoursOf = (page: Page): Locator => page.getByTestId("hours-last-30");
export const alertOf = (dialog: Locator): Locator => dialog.getByRole("alert");
/** The buttons any reading action could show on the tab: none of them for a reader. */
export const actionButtons = (page: Page): Locator =>
  page.getByRole("button", { name: new RegExp(`^(${rd.recordReading.trigger}|${rd.recordReading.triggerKm}|${rd.correctReading.trigger}|${rd.replaceMeter.trigger})$`, "u") });

const fieldOf = (dialog: Locator, label: string): Locator => dialog.getByLabel(label, { exact: true });

export type ReadingInput = { day?: string; value?: string; reason?: string };

/** Opens Registrar horas (a header button) with the browser's own checks off and fills what is given. */
export async function openRecord(page: Page, input: ReadingInput = {}): Promise<Locator> {
  const dialog = await openDialog(page, rd.recordReading.trigger, page.locator(".page-head"));
  await skipBrowserValidation(dialog);
  const t = rd.recordReading;
  if (input.day !== undefined) await fieldOf(dialog, t.dayLabel).fill(input.day);
  if (input.value !== undefined) await fieldOf(dialog, t.valueLabel).fill(input.value);
  if (input.reason !== undefined) await fieldOf(dialog, t.reasonLabel).fill(input.reason);
  return dialog;
}

/** Loads a reading and returns the dialog, so the caller reads the outcome (closed on success, an alert otherwise). */
export async function loadReading(page: Page, input: ReadingInput): Promise<Locator> {
  const dialog = await openRecord(page, input);
  await submitDialog(dialog, rd.recordReading.submit);
  return dialog;
}

export const expectLoaded = (page: Page): Promise<void> => expect(openDialogOf(page)).toBeHidden();

/** The history rows whose value text matches. */
export const rowWithValue = (page: Page, value: string): Locator => historyRows(page).filter({ hasText: value });

/** The history rows with a badge of exactly this text (the dialogs inside a row also carry words like "corrección"). */
export const rowWithBadge = (page: Page, label: string): Locator =>
  historyRows(page).filter({ has: page.locator(".badge").getByText(label, { exact: true }) });

/** Opens the Corregir dialog of a row. */
export async function openCorrect(page: Page, row: Locator): Promise<Locator> {
  const dialog = await openDialog(page, rd.correctReading.trigger, row);
  await skipBrowserValidation(dialog);
  return dialog;
}

export async function correctReading(page: Page, row: Locator, input: { value: string; reason?: string }): Promise<Locator> {
  const dialog = await openCorrect(page, row);
  await fieldOf(dialog, rd.correctReading.valueLabel).fill(input.value);
  if (input.reason !== undefined) await dialog.getByLabel(copy.common.reason, { exact: true }).fill(input.reason);
  await submitDialog(dialog, rd.correctReading.submit);
  return dialog;
}

export type ReplaceInput = { day?: string; final?: string; initial?: string; reason?: string };

export async function replaceMeter(page: Page, input: ReplaceInput): Promise<Locator> {
  const dialog = await openDialog(page, rd.replaceMeter.trigger, toolbar(page));
  await skipBrowserValidation(dialog);
  const t = rd.replaceMeter;
  if (input.day !== undefined) await fieldOf(dialog, t.dayLabel).fill(input.day);
  if (input.final !== undefined) await fieldOf(dialog, t.finalLabel).fill(input.final);
  if (input.initial !== undefined) await fieldOf(dialog, t.initialLabel).fill(input.initial);
  if (input.reason !== undefined) await dialog.getByLabel(copy.common.reason, { exact: true }).fill(input.reason);
  await submitDialog(dialog, t.submit);
  return dialog;
}

const openOwner = () => postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });

export type StoredReading = { kind: string; read_on: string; value_tenths: number; reason: string | null; corrects: boolean; meter_kind: string };
export type StoredMeter = { kind: string; opened_on: string; closed_on: string | null };

/** Every stored reading of an equipment in insertion order, with its meter's kind. */
export async function storedReadings(equipmentId: string): Promise<StoredReading[]> {
  const sql = openOwner();
  try {
    return await sql<StoredReading[]>`
      select r.kind, to_char(r.read_on, 'YYYY-MM-DD') as read_on, r.value_tenths, r.reason, (r.corrects_id is not null) as corrects, m.kind as meter_kind
      from meter_readings r join meters m on m.tenant_id = r.tenant_id and m.id = r.meter_id
      where m.equipment_id = ${equipmentId} order by r.seq`;
  } finally {
    await sql.end();
  }
}

export async function storedMeters(equipmentId: string): Promise<StoredMeter[]> {
  const sql = openOwner();
  try {
    return await sql<StoredMeter[]>`
      select kind, to_char(opened_on, 'YYYY-MM-DD') as opened_on, to_char(closed_on, 'YYYY-MM-DD') as closed_on
      from meters where equipment_id = ${equipmentId} order by created_at, id`;
  } finally {
    await sql.end();
  }
}

export type AuditRow = { action: string; reason: string | null; actor_role: string };

/** The metering audit entries of an equipment, oldest first. */
export async function meteringAudit(equipmentId: string): Promise<AuditRow[]> {
  const sql = openOwner();
  try {
    return await sql<AuditRow[]>`
      select action, reason, role as actor_role from audit_log
      where subject_equipment_id = ${equipmentId} and action like 'metering.%' order by id`;
  } finally {
    await sql.end();
  }
}

/** The audit actions of an equipment (its own entries and the subject ones), oldest first. */
export async function allActions(equipmentId: string): Promise<string[]> {
  const sql = openOwner();
  try {
    const rows = await sql<{ action: string }[]>`
      select action from audit_log where subject_equipment_id = ${equipmentId} or entity_id = ${equipmentId} order by id`;
    return rows.map((row) => row.action);
  } finally {
    await sql.end();
  }
}
