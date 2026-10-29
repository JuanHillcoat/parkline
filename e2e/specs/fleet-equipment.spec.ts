import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  createEquipmentViaUi,
  expectDialogClosed,
  fill,
  fillEquipment,
  gotoFleet,
  openDialog,
  REQUIRED_TEXT_DEFAULTS,
  rowOf,
  seedBase,
  skipBrowserValidation,
  submitDialog,
  tabLink,
  type EquipmentValues,
} from "../support/fleet-flows";
import { storageStatePath } from "../support/world";

const d = copy.dialogs;
const f = d.equipmentFields;
const byCode = copy.errors.byCode;
const byField = copy.errors.byField;
const nextYear = new Date().getFullYear() + 1;

async function seedBaseFleet(): Promise<void> {
  const seeder = await openSeeder();
  await seedBase(seeder, "Acme rental", "Forklift");
  await seeder.close();
}

/** Opens the new equipment dialog, fills it, skips the browser checks and submits. */
async function submitNewEquipment(page: Page, values: EquipmentValues): Promise<Locator> {
  await gotoFleet(page, "equipment");
  const dialog = await openDialog(page, d.newEquipment.trigger);
  await skipBrowserValidation(dialog);
  await fillEquipment(dialog, { supplier: "ACME RENTAL", assetType: "FORKLIFT", ...REQUIRED_TEXT_DEFAULTS, ...values });
  await submitDialog(dialog, d.newEquipment.submit);
  return dialog;
}

test.describe("creating equipment", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("offers no new equipment button until a supplier and an asset type exist", async ({ page }) => {
    await gotoFleet(page, "equipment");
    await expect(page.getByText(copy.fleet.emptyEquipment)).toBeVisible();
    await expect(page.getByText(copy.fleet.guidance.text)).toBeVisible();
    await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toHaveCount(0);
    const seeder = await openSeeder();
    await seeder.supplier("Only supplier");
    await seeder.close();
    await gotoFleet(page, "equipment");
    await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toHaveCount(0);
  });

  test("registers a unit with only the required fields (brand and model included) and shows dashes for the rest", async ({ page }) => {
    await seedBaseFleet();
    await createEquipmentViaUi(page, { code: "c-043", supplier: "ACME RENTAL", assetType: "FORKLIFT" });
    const row = rowOf(page, "C-043");
    await expect(row).toContainText("ACME RENTAL");
    await expect(row).toContainText("FORKLIFT");
    // No assignment yet (P0-08 T4): the state is "Sin asignar" and operation and site are dashes too.
    await expect(row).toContainText(copy.fleet.state.unassigned);
    await expect(row.getByRole("cell", { name: copy.fleet.noValue })).toHaveCount(3);
    await expect(row).toContainText("MARCA MODELO");
    await expect(tabLink(page, "equipment")).toContainText("1");
  });

  test("registers a unit with every field and shows brand, model, year, serial and observations", async ({ page }) => {
    await seedBaseFleet();
    await createEquipmentViaUi(page, {
      code: "F-100", supplier: "ACME RENTAL", assetType: "FORKLIFT", brand: "Hyster", model: "H50",
      year: "2019", serial: "SN-998", batteries: "3", observations: "Needs new tires",
    });
    const row = rowOf(page, "F-100");
    await expect(row).toContainText("Hyster H50");
    await expect(row).toContainText("2019");
    await expect(row).toContainText(`${copy.fleet.serialPrefix} SN-998`);
    await expect(row).toContainText("Needs new tires");
    const edit = await openDialog(page, d.editEquipment.trigger, row);
    await expect(edit.getByLabel(f.batteryQuantityLabel)).toHaveValue("3");
  });

  test("lists only active suppliers and asset types in the dialog", async ({ page }) => {
    await seedBaseFleet();
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.newEquipment.trigger);
    await expect(dialog.getByLabel(f.supplierLabel, { exact: true }).getByRole("option")).toHaveText([f.selectSupplier, "ACME RENTAL"]);
    await expect(dialog.getByLabel(f.assetTypeLabel, { exact: true }).getByRole("option")).toHaveText([f.selectAssetType, "FORKLIFT"]);
  });

  test("blocks the submit in the browser while a required field is empty", async ({ page }) => {
    await seedBaseFleet();
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.newEquipment.trigger);
    await submitDialog(dialog, d.newEquipment.submit);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByLabel(f.internalCodeLabel, { exact: true })).toBeFocused();
  });

  test("marks brand and model as required in the browser", async ({ page }) => {
    await seedBaseFleet();
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.newEquipment.trigger);
    await expect(dialog.getByLabel(f.brandLabel, { exact: true })).toHaveAttribute("required", "");
    await expect(dialog.getByLabel(f.modelLabel, { exact: true })).toHaveAttribute("required", "");
    await expect(dialog.getByLabel(f.yearLabel, { exact: true })).not.toHaveAttribute("required", "");
  });

  for (const [title, values] of [
    ["without a brand", { brand: "" }],
    ["with a blank brand", { brand: "   " }],
    ["without a model", { model: "" }],
    ["with a blank model", { model: "   " }],
  ] as const) {
    test(`rejects a new unit ${title}`, async ({ page }) => {
      await seedBaseFleet();
      const dialog = await submitNewEquipment(page, { code: "R-1", ...values });
      await expect(dialog.getByRole("alert")).toHaveText("brand" in values ? byField.brand : byField.model);
      await expect(dialog).toBeVisible();
    });
  }

  test("rejects a blank internal code and one longer than 40 characters", async ({ page }) => {
    await seedBaseFleet();
    const dialog = await submitNewEquipment(page, { code: "   " });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_internal_code);
    await fill(dialog, f.internalCodeLabel, "x".repeat(41));
    await submitDialog(dialog, d.newEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_internal_code);
  });

  test("rejects a duplicate internal code under the same supplier ignoring case and accents", async ({ page }) => {
    await seedBaseFleet();
    await createEquipmentViaUi(page, { code: "Á-1", supplier: "ACME RENTAL", assetType: "FORKLIFT" });
    const dialog = await submitNewEquipment(page, { code: "a-1" });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.internal_code_taken);
  });

  test("allows the same internal code under another supplier", async ({ page }) => {
    await seedBaseFleet();
    const seeder = await openSeeder();
    await seeder.supplier("Other rental");
    await seeder.close();
    await createEquipmentViaUi(page, { code: "9001", supplier: "ACME RENTAL", assetType: "FORKLIFT" });
    await createEquipmentViaUi(page, { code: "9001", supplier: "OTHER RENTAL", assetType: "FORKLIFT" });
    await expect(page.getByRole("row").filter({ hasText: "9001" })).toHaveCount(2);
  });

  for (const [title, values, message] of [
    ["a year before 1950", { year: "1949" }, byCode.invalid_year],
    ["a year after next year", { year: String(nextYear + 1) }, byCode.invalid_year],
    ["a year that is not a whole number", { year: "2019.5" }, byCode.invalid_year],
    ["more than 4 batteries", { batteries: "5" }, byCode.invalid_battery_quantity],
    ["a negative battery quantity", { batteries: "-1" }, byCode.invalid_battery_quantity],
    ["a brand over 120 characters", { brand: "b".repeat(121) }, byField.brand],
    ["a model over 120 characters", { model: "m".repeat(121) }, byField.model],
    ["a serial number over 60 characters", { serial: "s".repeat(61) }, byField.serialNumber],
    ["observations over 500 characters", { observations: "o".repeat(501) }, byField.observations],
  ] as const) {
    test(`rejects ${title}`, async ({ page }) => {
      await seedBaseFleet();
      const dialog = await submitNewEquipment(page, { code: "V-1", ...values });
      await expect(dialog.getByRole("alert")).toHaveText(message);
    });
  }

  test("accepts the limits: year 1950, next year, 0 and 4 batteries", async ({ page }) => {
    await seedBaseFleet();
    await createEquipmentViaUi(page, { code: "L-1", supplier: "ACME RENTAL", assetType: "FORKLIFT", year: "1950", batteries: "0" });
    await createEquipmentViaUi(page, { code: "L-2", supplier: "ACME RENTAL", assetType: "FORKLIFT", year: String(nextYear), batteries: "4" });
    await expect(rowOf(page, "L-1")).toContainText("1950");
    await expect(rowOf(page, "L-2")).toContainText(String(nextYear));
  });
});

test.describe("editing equipment", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(async () => {
    await resetCatalogs();
    const seeder = await openSeeder();
    const base = await seedBase(seeder, "Acme rental", "Forklift");
    await seeder.supplier("Other rental");
    await seeder.equipment({ supplierId: base.supplierId, assetTypeId: base.assetTypeId, internalCode: "E-1", brand: "Toyota", year: 2015 });
    await seeder.equipment({ supplierId: base.supplierId, assetTypeId: base.assetTypeId, internalCode: "E-2" });
    await seeder.close();
  });

  test("opens with the current values and the audit warning", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-1"));
    await expect(dialog.getByRole("heading", { name: d.editEquipment.title("E-1") })).toBeVisible();
    await expect(dialog.getByText(d.editEquipment.description)).toBeVisible();
    await expect(dialog.getByLabel(f.internalCodeLabel, { exact: true })).toHaveValue("E-1");
    await expect(dialog.getByLabel(f.brandLabel)).toHaveValue("Toyota");
    await expect(dialog.getByLabel(f.yearLabel)).toHaveValue("2015");
  });

  test("requires a reason, which must not be blank", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-1"));
    await fill(dialog, f.brandLabel, "Hyster");
    await fill(dialog, copy.common.reason, "   ");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
  });

  test("saves the new values and moves the unit to another supplier", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-1"));
    await fillEquipment(dialog, { code: "E-1B", supplier: "OTHER RENTAL", brand: "Hyster", model: "H60", year: "2020" });
    await fill(dialog, copy.common.reason, "Unit was transferred to another supplier");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    const row = rowOf(page, "E-1B");
    await expect(row).toContainText("OTHER RENTAL");
    await expect(row).toContainText("Hyster H60");
    await expect(row).toContainText("2020");
  });

  test("rejects an edit that leaves the model blank, and keeps both fields required", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-1"));
    await skipBrowserValidation(dialog);
    await fill(dialog, f.modelLabel, "   ");
    await fill(dialog, copy.common.reason, "Clearing the model");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byField.model);
    await expect(dialog.getByLabel(f.brandLabel, { exact: true })).toHaveAttribute("required", "");
    await expect(dialog.getByLabel(f.modelLabel, { exact: true })).toHaveAttribute("required", "");
  });

  test("rejects an edit that leaves the brand blank", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-1"));
    await skipBrowserValidation(dialog);
    await fill(dialog, f.brandLabel, "");
    await fill(dialog, copy.common.reason, "Clearing the brand");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byField.brand);
  });

  test("reports that there are no changes when nothing was modified", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-1"));
    await fill(dialog, copy.common.reason, "Checking");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.no_changes);
  });

  test("rejects an internal code already used by another unit of the supplier", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-2"));
    await fill(dialog, f.internalCodeLabel, "e-1");
    await fill(dialog, copy.common.reason, "Renumbering");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.internal_code_taken);
  });

  test("validates the edited values like the creation", async ({ page }) => {
    await gotoFleet(page, "equipment");
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "E-2"));
    await skipBrowserValidation(dialog);
    await fill(dialog, f.yearLabel, "1900");
    await fill(dialog, copy.common.reason, "Correcting the year");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_year);
  });
});

/** A small read-only fleet for the list tests: two suppliers, two types and four units. */
async function seedListFleet(): Promise<void> {
  const seeder = await openSeeder();
  const acme = await seeder.supplier("Acme rental");
  const rodriguez = await seeder.supplier("Rodríguez hermanos");
  const forklift = await seeder.assetType("Forklift");
  const truck = await seeder.assetType("Camión", "km", 5000);
  await seeder.equipment({ supplierId: acme, assetTypeId: forklift, internalCode: "A-1", brand: "Hyster", model: "H50", year: 2018 });
  await seeder.equipment({ supplierId: acme, assetTypeId: truck, internalCode: "A-2", brand: "Volvo", model: "FH16" });
  await seeder.equipment({ supplierId: rodriguez, assetTypeId: forklift, internalCode: "R-1", brand: "Toyota" });
  await seeder.equipment({ supplierId: rodriguez, assetTypeId: truck, internalCode: "R-2", brand: "Árbol", model: "Ñandú" });
  await seeder.close();
}

const codesIn = (page: Page): Locator => page.getByRole("rowheader");

test.describe("fleet tabs and counts", () => {
  test.use({ storageState: storageStatePath("viewer") });
  test.beforeAll(async () => {
    await resetCatalogs();
    await seedListFleet();
  });

  test("shows the equipment tab by default with the count of every section", async ({ page }) => {
    await gotoFleet(page);
    await expect(tabLink(page, "equipment")).toHaveAttribute("aria-current", "page");
    await expect(tabLink(page, "equipment")).toContainText("4");
    await expect(tabLink(page, "suppliers")).toContainText("2");
    await expect(tabLink(page, "asset-types")).toContainText("2");
  });

  test("switches sections with the tab links", async ({ page }) => {
    await gotoFleet(page);
    await tabLink(page, "suppliers").click();
    await expect(page).toHaveURL(/\/fleet\?tab=suppliers$/);
    await expect(tabLink(page, "suppliers")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("table", { name: copy.fleet.suppliersCaption })).toBeVisible();
    await tabLink(page, "asset-types").click();
    await expect(page.getByRole("table", { name: copy.fleet.assetTypesCaption })).toBeVisible();
    await tabLink(page, "equipment").click();
    await expect(page.getByRole("table", { name: copy.fleet.equipmentCaption })).toBeVisible();
  });

  test("falls back to the equipment tab for an unknown tab", async ({ page }) => {
    await page.goto("/fleet?tab=bogus");
    await expect(tabLink(page, "equipment")).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("table", { name: copy.fleet.equipmentCaption })).toBeVisible();
  });

  test("shows the unit and kilometer interval of an asset type", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    await expect(rowOf(page, "CAMIÓN")).toContainText("5000 km");
    await expect(rowOf(page, "CAMIÓN")).toContainText(copy.fleet.meter.km);
  });
});

test.describe("equipment search and filters", () => {
  test.use({ storageState: storageStatePath("viewer") });
  test.beforeAll(async () => {
    await resetCatalogs();
    await seedListFleet();
  });

  const search = async (page: Page, text: string): Promise<void> => {
    await page.getByLabel(copy.fleet.searchLabel).fill(text);
    await page.getByRole("button", { name: copy.fleet.applyFilters }).click();
  };

  for (const [field, text, expected] of [
    ["internal code", "a-2", ["A-2"]],
    ["brand", "hyster", ["A-1"]],
    ["model", "fh16", ["A-2"]],
    ["supplier ignoring accents", "rodriguez", ["R-1", "R-2"]],
    ["asset type ignoring accents", "camion", ["A-2", "R-2"]],
    ["brand with an accented letter", "arbol", ["R-2"]],
    ["model with an enye (kept as its own letter)", "ñandu", ["R-2"]],
  ] as const) {
    test(`searches by ${field}`, async ({ page }) => {
      await gotoFleet(page);
      await search(page, text);
      await expect(codesIn(page)).toHaveText([...expected]);
      await expect(page.getByLabel(copy.fleet.searchLabel)).toHaveValue(text);
    });
  }

  test("filters by supplier and by asset type", async ({ page }) => {
    await gotoFleet(page);
    await page.getByLabel(copy.fleet.supplierFilter, { exact: true }).selectOption({ label: "ACME RENTAL" });
    await page.getByRole("button", { name: copy.fleet.applyFilters }).click();
    await expect(codesIn(page)).toHaveText(["A-1", "A-2"]);
    await page.getByLabel(copy.fleet.typeFilter, { exact: true }).selectOption({ label: "CAMIÓN" });
    await page.getByRole("button", { name: copy.fleet.applyFilters }).click();
    await expect(codesIn(page)).toHaveText(["A-2"]);
  });

  test("shows the no-results state without the pagination hint, and clears the filters", async ({ page }) => {
    await gotoFleet(page);
    await search(page, "nothing matches this");
    await expect(page.getByText(copy.fleet.noResults)).toBeVisible();
    await expect(page.getByText(/Mostrando/)).toHaveCount(0);
    await page.getByRole("link", { name: copy.fleet.clearFilters }).click();
    await expect(page).toHaveURL(/\/fleet$/);
    await expect(codesIn(page)).toHaveCount(4);
    await expect(page.getByRole("link", { name: copy.fleet.clearFilters })).toHaveCount(0);
  });

  test("ignores a filter id that does not exist", async ({ page }) => {
    await page.goto("/fleet?supplier=not-a-real-id");
    await expect(codesIn(page)).toHaveCount(4);
  });

  test("shows no serial line for a unit without a serial number", async ({ page }) => {
    await page.goto("/fleet");
    await expect(rowOf(page, "A-1")).not.toContainText(copy.fleet.serialPrefix);
  });
});

test.describe("equipment secondary lines", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("finds a unit by its serial number and shows serial and observations", async ({ page }) => {
    await seedBaseFleet();
    await createEquipmentViaUi(page, {
      code: "S-1", supplier: "ACME RENTAL", assetType: "FORKLIFT", serial: "SERIE-XYZ-77", observations: "Left mast leaks",
    });
    await createEquipmentViaUi(page, { code: "S-2", supplier: "ACME RENTAL", assetType: "FORKLIFT" });
    await page.getByLabel(copy.fleet.searchLabel).fill("xyz-77");
    await page.getByRole("button", { name: copy.fleet.applyFilters }).click();
    await expect(codesIn(page)).toHaveText(["S-1"]);
    await expect(rowOf(page, "S-1")).toContainText(`${copy.fleet.serialPrefix} SERIE-XYZ-77`);
    await expect(rowOf(page, "S-1")).toContainText("Left mast leaks");
  });
});

test.describe("equipment pagination", () => {
  test.use({ storageState: storageStatePath("viewer") });
  const pad = (n: number): string => String(n).padStart(3, "0");

  test.beforeAll(async () => {
    await resetCatalogs();
    const seeder = await openSeeder();
    const base = await seedBase(seeder, "Big supplier", "Big type");
    const small = await seeder.supplier("Small supplier");
    for (let n = 1; n <= 25; n += 1) await seeder.equipment({ supplierId: base.supplierId, assetTypeId: base.assetTypeId, internalCode: `EQ-${pad(n)}` });
    for (let n = 26; n <= 45; n += 1) await seeder.equipment({ supplierId: small, assetTypeId: base.assetTypeId, internalCode: `EQ-${pad(n)}` });
    await seeder.close();
  });

  test("shows 20 units per page with the range and the page links", async ({ page }) => {
    await gotoFleet(page);
    await expect(codesIn(page)).toHaveCount(20);
    await expect(codesIn(page).first()).toHaveText("EQ-001");
    await expect(page.getByText(copy.fleet.showing(1, 20, 45))).toBeVisible();
    const nav = page.getByRole("navigation", { name: copy.fleet.paginationLabel });
    await expect(nav.getByRole("link", { name: copy.fleet.pageLink(1) })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: copy.fleet.previousPage })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: copy.fleet.pageLink(3) })).toBeVisible();
  });

  test("moves between pages with next, previous and numbered links", async ({ page }) => {
    await gotoFleet(page);
    const nav = page.getByRole("navigation", { name: copy.fleet.paginationLabel });
    await nav.getByRole("link", { name: copy.fleet.nextPage }).click();
    await expect(page).toHaveURL(/page=2$/);
    await expect(page.getByText(copy.fleet.showing(21, 40, 45))).toBeVisible();
    await expect(codesIn(page).first()).toHaveText("EQ-021");
    await nav.getByRole("link", { name: copy.fleet.pageLink(3) }).click();
    await expect(page.getByText(copy.fleet.showing(41, 45, 45))).toBeVisible();
    await expect(codesIn(page)).toHaveCount(5);
    await expect(nav.getByRole("link", { name: copy.fleet.nextPage })).toHaveCount(0);
    await nav.getByRole("link", { name: copy.fleet.previousPage }).click();
    await expect(page.getByText(copy.fleet.showing(21, 40, 45))).toBeVisible();
  });

  test("clamps an out-of-range page and treats a bad page as the first", async ({ page }) => {
    await page.goto("/fleet?page=99");
    await expect(page.getByText(copy.fleet.showing(41, 45, 45))).toBeVisible();
    for (const bad of ["0", "abc", "-3"]) {
      await page.goto(`/fleet?page=${bad}`);
      await expect(page.getByText(copy.fleet.showing(1, 20, 45))).toBeVisible();
    }
  });

  test("keeps the supplier filter across pages", async ({ page }) => {
    await gotoFleet(page);
    await page.getByLabel(copy.fleet.supplierFilter, { exact: true }).selectOption({ label: "BIG SUPPLIER" });
    await page.getByRole("button", { name: copy.fleet.applyFilters }).click();
    await expect(page.getByText(copy.fleet.showing(1, 20, 25))).toBeVisible();
    await page.getByRole("navigation", { name: copy.fleet.paginationLabel }).getByRole("link", { name: copy.fleet.nextPage }).click();
    await expect(page.getByText(copy.fleet.showing(21, 25, 25))).toBeVisible();
    await expect(page.getByLabel(copy.fleet.supplierFilter, { exact: true }).locator("option:checked")).toHaveText("BIG SUPPLIER");
  });

  test("keeps the search text across pages and drops the page links when everything fits", async ({ page }) => {
    await page.goto("/fleet?q=EQ-0");
    await page.getByRole("navigation", { name: copy.fleet.paginationLabel }).getByRole("link", { name: copy.fleet.nextPage }).click();
    await expect(page.getByLabel(copy.fleet.searchLabel)).toHaveValue("EQ-0");
    await page.goto("/fleet?q=EQ-04");
    await expect(page.getByText(copy.fleet.showing(1, 6, 6))).toBeVisible();
    await expect(page.getByRole("navigation", { name: copy.fleet.paginationLabel })).toHaveCount(0);
  });
});
