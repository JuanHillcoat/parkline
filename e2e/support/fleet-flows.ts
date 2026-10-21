/**
 * Reusable steps for the fleet suites: open and submit the dialogs of `/fleet` the way a person
 * does, and read the rows of its tables. Every flow goes through the real screens.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import type { Seeder } from "./data";

const t = copy.dialogs;

export type FleetSection = "equipment" | "suppliers" | "asset-types";

/** The only open modal dialog (closed dialogs are hidden, so they never match). */
export const openDialogOf = (page: Page): Locator => page.getByRole("dialog");

/** Opens `/fleet` on a section; extra query parameters go after the tab. */
export async function gotoFleet(page: Page, section: FleetSection = "equipment", extra = ""): Promise<void> {
  const tab = section === "equipment" ? "" : `tab=${section}`;
  const query = [tab, extra].filter((part) => part !== "").join("&");
  await page.goto(query === "" ? "/fleet" : `/fleet?${query}`);
  await expect(page.getByRole("heading", { level: 1, name: copy.fleet.title })).toBeVisible();
}

/** The table row that contains `text` (names are unique per test). */
export const rowOf = (page: Page, text: string): Locator => page.getByRole("row").filter({ hasText: text });

/**
 * Clicks a trigger button and waits for the dialog. The click is repeated until the dialog shows
 * because a click that lands before React has hydrated the page does nothing.
 */
export async function openDialog(page: Page, trigger: string, scope: Page | Locator = page): Promise<Locator> {
  const dialog = openDialogOf(page);
  await expect(async () => {
    if (!(await dialog.isVisible())) await scope.getByRole("button", { name: trigger, exact: true }).click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return dialog;
}

/** Turns off the browser's own checks so the server-side validation is the one answering. */
export async function skipBrowserValidation(dialog: Locator): Promise<void> {
  await dialog.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });
}

export const submitDialog = (dialog: Locator, label: string): Promise<void> =>
  dialog.getByRole("button", { name: label, exact: true }).click();

/** Waits until the dialog closes, which is how a successful action looks. */
export const expectDialogClosed = (page: Page): Promise<void> => expect(openDialogOf(page)).toBeHidden();

/** Fills a text field by its label. */
export const fill = (dialog: Locator, label: string, value: string): Promise<void> =>
  dialog.getByLabel(label, { exact: true }).fill(value);

export async function createSupplierViaUi(page: Page, name: string): Promise<void> {
  await gotoFleet(page, "suppliers");
  const dialog = await openDialog(page, t.newSupplier.trigger);
  await fill(dialog, t.newSupplier.nameLabel, name);
  await submitDialog(dialog, t.newSupplier.submit);
  await expectDialogClosed(page);
}

export type AssetTypeValues = { name: string; meter?: "hours" | "km" | "none"; interval?: string };

/** Fills the name, meter and interval fields of the new or edit asset type dialog. */
export async function fillAssetType(dialog: Locator, values: AssetTypeValues): Promise<void> {
  await fill(dialog, t.newAssetType.nameLabel, values.name);
  if (values.meter !== undefined) await dialog.getByLabel(t.meterFields.meterLabel, { exact: true }).selectOption(values.meter);
  if (values.interval !== undefined) await fill(dialog, t.meterFields.intervalLabel, values.interval);
}

export async function createAssetTypeViaUi(page: Page, values: AssetTypeValues): Promise<void> {
  await gotoFleet(page, "asset-types");
  const dialog = await openDialog(page, t.newAssetType.trigger);
  await fillAssetType(dialog, values);
  await submitDialog(dialog, t.newAssetType.submit);
  await expectDialogClosed(page);
}

export type EquipmentValues = {
  code: string;
  supplier?: string;
  assetType?: string;
  brand?: string;
  model?: string;
  year?: string;
  serial?: string;
  batteries?: string;
  observations?: string;
};

const f = t.equipmentFields;

/** Sets the textarea value directly: typing would stop at its 500-character limit, and the server must answer for longer text. */
const setObservations = (dialog: Locator, value: string): Promise<void> =>
  dialog.getByLabel(t.equipmentFields.observationsLabel, { exact: true }).evaluate((field: HTMLTextAreaElement, text: string) => {
    field.value = text;
  }, value);

/** Fills the equipment form; only the fields that are given are touched. */
export async function fillEquipment(dialog: Locator, v: EquipmentValues): Promise<void> {
  await fill(dialog, f.internalCodeLabel, v.code);
  if (v.supplier !== undefined) await dialog.getByLabel(f.supplierLabel, { exact: true }).selectOption({ label: v.supplier });
  if (v.assetType !== undefined) await dialog.getByLabel(f.assetTypeLabel, { exact: true }).selectOption({ label: v.assetType });
  const optional: readonly (readonly [string, string | undefined])[] = [
    [f.brandLabel, v.brand], [f.modelLabel, v.model], [f.yearLabel, v.year],
    [f.serialNumberLabel, v.serial], [f.batteryQuantityLabel, v.batteries],
  ];
  for (const [label, value] of optional) if (value !== undefined) await fill(dialog, label, value);
  if (v.observations !== undefined) await setObservations(dialog, v.observations);
}

export async function createEquipmentViaUi(page: Page, values: EquipmentValues): Promise<void> {
  await gotoFleet(page, "equipment");
  const dialog = await openDialog(page, t.newEquipment.trigger);
  await fillEquipment(dialog, values);
  await submitDialog(dialog, t.newEquipment.submit);
  await expectDialogClosed(page);
}

/** Archives or restores the row that contains `text`, with a reason, and waits for the dialog to close. */
export async function changeArchiveState(page: Page, text: string, verb: "archive" | "restore", reason: string): Promise<void> {
  const label = copy.dialogs[verb];
  const dialog = await openDialog(page, label.trigger, rowOf(page, text));
  await fill(dialog, copy.common.reason, reason);
  await submitDialog(dialog, label.submit);
  await expectDialogClosed(page);
}

/** Opens the archive or restore dialog, submits it and returns the dialog so the caller reads the error. */
export async function attemptArchiveChange(page: Page, text: string, verb: "archive" | "restore", reason: string): Promise<Locator> {
  const label = copy.dialogs[verb];
  const dialog = await openDialog(page, label.trigger, rowOf(page, text));
  await fill(dialog, copy.common.reason, reason);
  await submitDialog(dialog, label.submit);
  return dialog;
}

/** The link of a section tab; its accessible name also carries the count pill. */
export const tabLink = (page: Page, section: FleetSection): Locator => {
  const label = { equipment: copy.fleet.tabs.equipment, suppliers: copy.fleet.tabs.suppliers, "asset-types": copy.fleet.tabs.assetTypes }[section];
  return page.getByRole("navigation", { name: copy.fleet.tabsLabel }).getByRole("link", { name: new RegExp(`^${label}`, "u") });
};

export type BaseFleet = { supplierId: string; assetTypeId: string; supplier: string; assetType: string };

/** One supplier and one asset type, the minimum to register equipment. */
export async function seedBase(seeder: Seeder, supplier = "Base supplier", assetType = "Base type"): Promise<BaseFleet> {
  return {
    supplierId: await seeder.supplier(supplier),
    assetTypeId: await seeder.assetType(assetType),
    supplier: supplier.toUpperCase(),
    assetType: assetType.toUpperCase(),
  };
}
