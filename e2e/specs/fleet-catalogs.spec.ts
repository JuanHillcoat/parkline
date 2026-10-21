import { expect, test } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  createAssetTypeViaUi,
  createSupplierViaUi,
  expectDialogClosed,
  fill,
  fillAssetType,
  gotoFleet,
  openDialog,
  rowOf,
  skipBrowserValidation,
  submitDialog,
  tabLink,
} from "../support/fleet-flows";
import { storageStatePath } from "../support/world";

const d = copy.dialogs;
const byCode = copy.errors.byCode;

test.describe("fleet suppliers", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("starts empty and shows the empty state and a zero count", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    await expect(page.getByText(copy.fleet.emptySuppliers)).toBeVisible();
    await expect(tabLink(page, "suppliers")).toContainText("0");
  });

  test("creates a supplier, stores the name in uppercase and updates the count", async ({ page }) => {
    await createSupplierViaUi(page, "Rental norte");
    await expect(rowOf(page, "RENTAL NORTE")).toBeVisible();
    await expect(tabLink(page, "suppliers")).toContainText("1");
  });

  test("tells the person that names are stored in uppercase", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    const dialog = await openDialog(page, d.newSupplier.trigger);
    await expect(dialog.getByText(d.newSupplier.nameHint)).toBeVisible();
    await expect(dialog.getByRole("heading", { name: d.newSupplier.title })).toBeVisible();
  });

  test("cancel closes the dialog without creating anything", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    const dialog = await openDialog(page, d.newSupplier.trigger);
    await fill(dialog, d.newSupplier.nameLabel, "Never saved");
    await dialog.getByRole("button", { name: copy.common.cancel }).click();
    await expectDialogClosed(page);
    await expect(page.getByText("NEVER SAVED")).toHaveCount(0);
  });

  test("rejects a duplicate name ignoring case and accents and keeps the dialog open", async ({ page }) => {
    await createSupplierViaUi(page, "Rodríguez hermanos");
    await gotoFleet(page, "suppliers");
    const dialog = await openDialog(page, d.newSupplier.trigger);
    await fill(dialog, d.newSupplier.nameLabel, "RODRIGUEZ HERMANOS");
    await submitDialog(dialog, d.newSupplier.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.name_taken);
    await expect(dialog.getByLabel(d.newSupplier.nameLabel)).toHaveValue("RODRIGUEZ HERMANOS");
  });

  test("rejects a blank name and a name longer than 120 characters", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    const dialog = await openDialog(page, d.newSupplier.trigger);
    await skipBrowserValidation(dialog);
    await fill(dialog, d.newSupplier.nameLabel, "   ");
    await submitDialog(dialog, d.newSupplier.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_name);
    await fill(dialog, d.newSupplier.nameLabel, "x".repeat(121));
    await submitDialog(dialog, d.newSupplier.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_name);
  });

  test("renames a supplier without asking for a reason", async ({ page }) => {
    const seeder = await openSeeder();
    await seeder.supplier("Typo supplier");
    await seeder.close();
    await gotoFleet(page, "suppliers");
    const dialog = await openDialog(page, d.rename.trigger, rowOf(page, "TYPO SUPPLIER"));
    await expect(dialog.getByLabel(copy.common.reason)).toHaveCount(0);
    await fill(dialog, d.rename.nameLabel, "Fixed supplier");
    await submitDialog(dialog, d.rename.submit);
    await expectDialogClosed(page);
    await expect(rowOf(page, "FIXED SUPPLIER")).toBeVisible();
    await expect(page.getByText("TYPO SUPPLIER")).toHaveCount(0);
  });

  test("rejects renaming a supplier to the name of another one", async ({ page }) => {
    const seeder = await openSeeder();
    await seeder.supplier("First supplier");
    await seeder.supplier("Second supplier");
    await seeder.close();
    await gotoFleet(page, "suppliers");
    const dialog = await openDialog(page, d.rename.trigger, rowOf(page, "SECOND SUPPLIER"));
    await fill(dialog, d.rename.nameLabel, "first supplier");
    await submitDialog(dialog, d.rename.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.name_taken);
  });

  test("lists suppliers ordered by name with their count of active equipment", async ({ page }) => {
    const seeder = await openSeeder();
    const beta = await seeder.supplier("Beta rental");
    await seeder.supplier("Alfa rental");
    const type = await seeder.assetType("Any type");
    await seeder.equipment({ supplierId: beta, assetTypeId: type, internalCode: "B-1" });
    await seeder.equipment({ supplierId: beta, assetTypeId: type, internalCode: "B-2" });
    await seeder.close();
    await gotoFleet(page, "suppliers");
    await expect(page.getByRole("row")).toHaveCount(3);
    await expect(page.getByRole("row").nth(1)).toContainText("ALFA RENTAL");
    await expect(rowOf(page, "BETA RENTAL").getByRole("cell", { name: "2" })).toBeVisible();
  });
});

test.describe("fleet asset types", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("starts empty and shows the empty state", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    await expect(page.getByText(copy.fleet.emptyAssetTypes)).toBeVisible();
  });

  test("creates asset types with each meter kind and shows the interval in the meter unit", async ({ page }) => {
    await createAssetTypeViaUi(page, { name: "Forklift", meter: "hours", interval: "250" });
    await createAssetTypeViaUi(page, { name: "Truck", meter: "km", interval: "5000" });
    await createAssetTypeViaUi(page, { name: "Container", meter: "none" });
    await expect(rowOf(page, "FORKLIFT")).toContainText(`${copy.fleet.meter.hours}250 h`);
    await expect(rowOf(page, "TRUCK")).toContainText(`${copy.fleet.meter.km}5000 km`);
    await expect(rowOf(page, "CONTAINER")).toContainText(`${copy.fleet.meter.none}${copy.fleet.noValue}`);
  });

  test("accepts a meter without an interval and shows a dash", async ({ page }) => {
    await createAssetTypeViaUi(page, { name: "Pallet jack", meter: "hours" });
    await expect(rowOf(page, "PALLET JACK")).toContainText(`${copy.fleet.meter.hours}${copy.fleet.noValue}`);
  });

  test("disables the interval while the meter is none and enables it again", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.newAssetType.trigger);
    const interval = dialog.getByLabel(d.meterFields.intervalLabel);
    const meter = dialog.getByLabel(d.meterFields.meterLabel, { exact: true });
    await expect(interval).toBeEnabled();
    await meter.selectOption("none");
    await expect(interval).toBeDisabled();
    await expect(dialog.getByText(d.meterFields.intervalNone, { exact: true })).toBeVisible();
    await meter.selectOption("km");
    await expect(interval).toBeEnabled();
  });

  for (const value of ["0", "10001", "1.5"]) {
    test(`rejects the interval ${value}`, async ({ page }) => {
      await gotoFleet(page, "asset-types");
      const dialog = await openDialog(page, d.newAssetType.trigger);
      await skipBrowserValidation(dialog);
      await fillAssetType(dialog, { name: "Bad interval", meter: "hours", interval: value });
      await submitDialog(dialog, d.newAssetType.submit);
      await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_preventive_interval);
    });
  }

  test("the server rejects an interval for a type without a meter", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.newAssetType.trigger);
    await fillAssetType(dialog, { name: "Container", meter: "hours", interval: "100" });
    await dialog.getByLabel(d.meterFields.meterLabel, { exact: true }).selectOption("none");
    // The input is disabled by the screen; enabling it simulates a forged request.
    await dialog.getByLabel(d.meterFields.intervalLabel).evaluate((input: HTMLInputElement) => {
      input.disabled = false;
    });
    await submitDialog(dialog, d.newAssetType.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.preventive_interval_not_allowed);
  });

  test("rejects a duplicate name ignoring case and accents", async ({ page }) => {
    await createAssetTypeViaUi(page, { name: "Autoelevador" });
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.newAssetType.trigger);
    await fillAssetType(dialog, { name: "AUTOÉLEVADOR" });
    await submitDialog(dialog, d.newAssetType.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.name_taken);
  });

  test("rejects a blank name", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.newAssetType.trigger);
    await skipBrowserValidation(dialog);
    await fillAssetType(dialog, { name: "  " });
    await submitDialog(dialog, d.newAssetType.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_name);
  });
});

test.describe("editing an asset type", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(async () => {
    await resetCatalogs();
    const seeder = await openSeeder();
    await seeder.assetType("Reach truck", "hours", 200);
    await seeder.close();
  });

  test("opens with the current values", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "REACH TRUCK"));
    await expect(dialog.getByRole("heading", { name: d.editAssetType.title("REACH TRUCK") })).toBeVisible();
    await expect(dialog.getByLabel(d.editAssetType.nameLabel)).toHaveValue("REACH TRUCK");
    await expect(dialog.getByLabel(d.meterFields.meterLabel, { exact: true })).toHaveValue("hours");
    await expect(dialog.getByLabel(d.meterFields.intervalLabel)).toHaveValue("200");
  });

  test("requires a reason, which must not be blank", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "REACH TRUCK"));
    await fillAssetType(dialog, { name: "Reach truck", interval: "300" });
    await fill(dialog, copy.common.reason, "   ");
    await submitDialog(dialog, d.editAssetType.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
  });

  test("blocks the submit in the browser while the reason field is empty", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "REACH TRUCK"));
    await fill(dialog, d.meterFields.intervalLabel, "300");
    await submitDialog(dialog, d.editAssetType.submit);
    const missing = await dialog.getByLabel(copy.common.reason).evaluate((field: HTMLTextAreaElement) => field.validity.valueMissing);
    expect(missing).toBe(true);
    await expect(dialog).toBeVisible();
  });

  test("saves a change with a reason", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "REACH TRUCK"));
    await fill(dialog, d.meterFields.intervalLabel, "300");
    await fill(dialog, copy.common.reason, "Manufacturer changed the service plan");
    await submitDialog(dialog, d.editAssetType.submit);
    await expectDialogClosed(page);
    await expect(rowOf(page, "REACH TRUCK")).toContainText("300 h");
  });

  test("reports that there are no changes when nothing was modified", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "REACH TRUCK"));
    await fill(dialog, copy.common.reason, "Checking");
    await submitDialog(dialog, d.editAssetType.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.no_changes);
  });

  test("switching the meter to none clears the interval", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "REACH TRUCK"));
    await dialog.getByLabel(d.meterFields.meterLabel, { exact: true }).selectOption("none");
    await fill(dialog, copy.common.reason, "The type has no meter");
    await submitDialog(dialog, d.editAssetType.submit);
    await expectDialogClosed(page);
    await expect(rowOf(page, "REACH TRUCK")).toContainText(`${copy.fleet.meter.none}${copy.fleet.noValue}`);
  });

  test("rejects renaming to the name of another type", async ({ page }) => {
    const seeder = await openSeeder();
    await seeder.assetType("Other type");
    await seeder.close();
    await gotoFleet(page, "asset-types");
    const dialog = await openDialog(page, d.editAssetType.trigger, rowOf(page, "OTHER TYPE"));
    await fill(dialog, d.editAssetType.nameLabel, "reach truck");
    await fill(dialog, copy.common.reason, "Rename");
    await submitDialog(dialog, d.editAssetType.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.name_taken);
  });
});
