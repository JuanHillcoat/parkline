/**
 * Steps for the compact registration form (issue 54): the fixture, the way a person fills the Nuevo equipo
 * dialog (battery kind, Horómetro, Operación or Muleto and its Site, "Desde el día", Observaciones), readers of the
 * visible fields and of what was stored.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { copy } from "../../app/_lib/copy";
import { openSeeder } from "./data";
import {
  expectDialogClosed,
  fillEquipment,
  gotoFleet,
  openDialog,
  REQUIRED_TEXT_DEFAULTS,
  skipBrowserValidation,
  submitDialog,
  type EquipmentValues,
} from "./fleet-flows";
import { fillAssignment, type AssignmentChoice } from "./register-assigned-flows";
import { readWorld } from "./world";

export const n = copy.dialogs.newEquipment;
export const f = copy.dialogs.equipmentFields;
export const p = copy.dialogs.placement;
export const messages = copy.errors.byCode;

/** Names are stored in uppercase. Two sites: the world's own and SITE_B, which holds OP_B. */
export const FX = {
  supplier: "RF SUPPLIER",
  types: { hours: "RF HOURS", km: "RF KM", none: "RF NONE" },
  opOne: "RF OP ONE",
  opTwo: "RF OP TWO",
  opB: "RF OP B",
  siteB: "RF SITE B",
} as const;

export type FormFixture = {
  readonly opOne: string;
  readonly opTwo: string;
  readonly opB: string;
  readonly siteB: string;
  readonly supplierId: string;
  readonly hoursTypeId: string;
};

/** One supplier, one type per meter kind, two operations at the world's site and one operation at a second site. */
export async function seedFormFixture(): Promise<FormFixture> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplierId = await seeder.supplier(FX.supplier);
    const hoursTypeId = await seeder.assetType(FX.types.hours, "hours");
    await seeder.assetType(FX.types.km, "km");
    await seeder.assetType(FX.types.none, "none");
    const siteB = await seeder.site(FX.siteB);
    const opOne = await seeder.operation({ division: world.division, site: world.site, name: FX.opOne, costCenter: "7601" });
    const opTwo = await seeder.operation({ division: world.division, site: world.site, name: FX.opTwo, costCenter: "7602" });
    const opB = await seeder.operation({ division: world.division, site: siteB, name: FX.opB, costCenter: "7603" });
    return { opOne, opTwo, opB, siteB, supplierId, hoursTypeId };
  } finally {
    await seeder.close();
  }
}

/** An equipment of the fixture (type RF HOURS, so a replacement option reads `<code> - RF HOURS`), optionally open in an operation. */
export async function seedUnit(fx: FormFixture, code: string, operationId?: string): Promise<string> {
  const seeder = await openSeeder();
  try {
    const id = await seeder.equipment({ supplierId: fx.supplierId, assetTypeId: fx.hoursTypeId, internalCode: code });
    if (operationId !== undefined) await seeder.assign({ equipmentId: id, operationId });
    return id;
  } finally {
    await seeder.close();
  }
}

/** What a registration takes: the equipment fields plus where it goes, the reading and the day. */
export type Registration = EquipmentValues & AssignmentChoice & { reading?: string };

/** Opens the Nuevo equipo dialog; the browser's own checks stay on unless asked, because some tests need them. */
export async function openRegistration(page: Page, options: { skipChecks?: boolean } = {}): Promise<Locator> {
  await gotoFleet(page, "equipment");
  const dialog = await openDialog(page, n.trigger);
  if (options.skipChecks === true) await skipBrowserValidation(dialog);
  return dialog;
}

/** The meter field, whichever way it is labeled for the chosen type. */
export const meterField = (dialog: Locator): Locator => dialog.getByLabel(/^(Horómetro|Kilometraje)$/u);

/** Fills the dialog the way a person does: identity and battery first, then the reading, then where it goes. */
export async function fillRegistration(dialog: Locator, v: Registration): Promise<void> {
  const equipment = { supplier: FX.supplier, assetType: FX.types.hours, ...REQUIRED_TEXT_DEFAULTS, ...v };
  await fillEquipment(dialog, equipment);
  if (v.reading !== undefined) await meterField(dialog).fill(v.reading);
  await fillAssignment(dialog, v);
}

/** Opens, fills and submits; returns the dialog so the caller reads the outcome (closed on success, an alert otherwise). */
export async function register(page: Page, v: Registration, options: { skipChecks?: boolean } = {}): Promise<Locator> {
  const dialog = await openRegistration(page, options);
  await fillRegistration(dialog, v);
  await submitDialog(dialog, n.submit);
  return dialog;
}

export async function registerOk(page: Page, v: Registration): Promise<void> {
  await register(page, v);
  await expectDialogClosed(page);
}

/** The visible labels of the dialog's fields, in the order the person reads them. */
export const visibleLabels = (dialog: Locator): Promise<string[]> =>
  dialog.locator("form label[for]").evaluateAll((labels) =>
    labels.filter((label) => (label as HTMLElement).offsetParent !== null).map((label) => label.textContent.trim()),
  );

/** The expected labels of a registration dialog in its default state: no quantity, no meter, no Site. */
export const DEFAULT_LABELS = [
  f.internalCodeLabel, f.supplierLabel, f.assetTypeLabel, f.brandLabel, f.modelLabel, f.yearLabel, f.serialNumberLabel,
  f.batteryKindLabel, copy.dialogs.imageField.label, n.operationLabel, n.dayLabel, f.observationsLabel,
] as const;

/** The labels with every conditional field shown: lead acid, a type with a meter and Muleto. */
export const FULL_LABELS = [
  f.internalCodeLabel, f.supplierLabel, f.assetTypeLabel, f.brandLabel, f.modelLabel, f.yearLabel, f.serialNumberLabel,
  f.batteryKindLabel, f.batteryQuantityLabel, n.readingLabel.hours, copy.dialogs.imageField.label, n.operationLabel, p.siteLabel,
  n.dayLabel, f.observationsLabel,
] as const;

/** Chooses the conditional fields that make the dialog its tallest: lead acid, a meter, Muleto. */
export async function showEverything(dialog: Locator): Promise<void> {
  await dialog.getByLabel(f.assetTypeLabel, { exact: true }).selectOption({ label: FX.types.hours });
  await dialog.getByLabel(f.batteryKindLabel, { exact: true }).selectOption("lead_acid");
  await dialog.getByLabel(n.operationLabel, { exact: true }).selectOption({ label: p.muleto });
}

const openOwner = () => postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });

export type StoredEquipment = {
  readonly id: string;
  readonly battery_kind: string | null;
  readonly battery_quantity: number | null;
  readonly observations: string | null;
};

/** The stored equipment with this code, or null when it was not created. */
export async function storedEquipment(code: string): Promise<StoredEquipment | null> {
  const sql = openOwner();
  try {
    const rows = await sql<StoredEquipment[]>`
      select id, battery_kind, battery_quantity, observations from equipments where internal_code = ${code.toUpperCase()}`;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

/** The number of meters, readings and assignments stored for an equipment code: all zero when nothing was created. */
export async function footprint(code: string): Promise<{ equipments: number; assignments: number; readings: number }> {
  const sql = openOwner();
  try {
    const [row] = await sql<{ equipments: number; assignments: number; readings: number }[]>`
      select (select count(*)::int from equipments where internal_code = ${code.toUpperCase()}) as equipments,
             (select count(*)::int from equipment_assignments a join equipments e on e.id = a.equipment_id
                where e.internal_code = ${code.toUpperCase()}) as assignments,
             (select count(*)::int from meter_readings r
                join meters m on m.tenant_id = r.tenant_id and m.id = r.meter_id
                join equipments e on e.id = m.equipment_id
                where e.internal_code = ${code.toUpperCase()}) as readings`;
    return row ?? { equipments: 0, assignments: 0, readings: 0 };
  } finally {
    await sql.end();
  }
}

/** The dialog stays open with an alert and nothing was created. */
export async function expectRefused(dialog: Locator, code: string, message: string): Promise<void> {
  await expect(dialog.getByRole("alert")).toHaveText(message);
  expect(await footprint(code)).toEqual({ equipments: 0, assignments: 0, readings: 0 });
}
