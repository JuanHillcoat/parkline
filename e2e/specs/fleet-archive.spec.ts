import { expect, test } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  attemptArchiveChange,
  changeArchiveState,
  createEquipmentViaUi,
  createSupplierViaUi,
  gotoFleet,
  openDialog,
  rowOf,
  seedBase,
  tabLink,
} from "../support/fleet-flows";
import { storageStatePath } from "../support/world";

const d = copy.dialogs;
const byCode = copy.errors.byCode;
const REASON = "Agreed with the fleet manager";

/** One supplier, one asset type and one unit, all active. */
async function seedUnit(code = "U-1"): Promise<void> {
  const seeder = await openSeeder();
  const base = await seedBase(seeder, "Acme rental", "Forklift");
  await seeder.equipment({ supplierId: base.supplierId, assetTypeId: base.assetTypeId, internalCode: code });
  await seeder.close();
}

test.describe("archiving as a fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("archives a unit with a reason and hides it from the active list", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await expect(rowOf(page, "U-1")).toHaveCount(0);
    await expect(page.getByText(copy.fleet.emptyEquipment)).toBeVisible();
  });

  test("asks for a reason and rejects a blank one", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    const dialog = await attemptArchiveChange(page, "U-1", "archive", "   ");
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
    await expect(dialog.getByRole("heading", { name: d.archive.title("U-1") })).toBeVisible();
    await expect(rowOf(page, "U-1")).toBeVisible();
  });

  test("rejects a reason longer than 500 characters", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    const dialog = await attemptArchiveChange(page, "U-1", "archive", "r".repeat(501));
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_too_long);
  });

  test("cannot archive a supplier that still has active equipment", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page, "suppliers");
    const dialog = await attemptArchiveChange(page, "ACME RENTAL", "archive", REASON);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.has_active_equipment);
  });

  test("cannot archive an asset type that still has active equipment", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page, "asset-types");
    const dialog = await attemptArchiveChange(page, "FORKLIFT", "archive", REASON);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.has_active_equipment);
  });

  test("archives a supplier and an asset type once their equipment is archived", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await gotoFleet(page, "suppliers");
    await changeArchiveState(page, "ACME RENTAL", "archive", REASON);
    await gotoFleet(page, "asset-types");
    await changeArchiveState(page, "FORKLIFT", "archive", REASON);
    await expect(page.getByText(copy.fleet.emptyAssetTypes)).toBeVisible();
  });

  test("the archived view lists archived rows with a tag and only offers to restore them", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await page.getByRole("link", { name: copy.fleet.showArchived }).click();
    await expect(page).toHaveURL(/archived=1/);
    const row = rowOf(page, "U-1");
    await expect(row).toContainText(copy.common.archivedTag);
    await expect(row.getByRole("button", { name: d.restore.trigger, exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: d.editEquipment.trigger, exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: d.archive.trigger, exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: copy.fleet.hideArchived }).click();
    await expect(rowOf(page, "U-1")).toHaveCount(0);
  });

  test("the archived toggle is kept when moving between tabs", async ({ page }) => {
    await gotoFleet(page, "equipment", "archived=1");
    await tabLink(page, "suppliers").click();
    await expect(page).toHaveURL(/tab=suppliers&archived=1|archived=1&tab=suppliers/);
    await expect(page.getByRole("link", { name: copy.fleet.hideArchived })).toBeVisible();
  });

  test("restores a unit with a reason", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await gotoFleet(page, "equipment", "archived=1");
    await changeArchiveState(page, "U-1", "restore", "Archived by mistake");
    await gotoFleet(page);
    await expect(rowOf(page, "U-1")).toContainText(copy.common.active);
  });

  test("restoring needs a reason as well", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await gotoFleet(page, "equipment", "archived=1");
    const dialog = await attemptArchiveChange(page, "U-1", "restore", "  ");
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
  });

  test("an archived unit frees its internal code, and restoring the old one then fails", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await createEquipmentViaUi(page, { code: "U-1", supplier: "ACME RENTAL", assetType: "FORKLIFT" });
    await gotoFleet(page, "equipment", "archived=1");
    const dialog = await attemptArchiveChange(page, "U-1", "restore", REASON);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.internal_code_taken);
  });

  test("an archived supplier frees its name, and restoring the old one then fails", async ({ page }) => {
    const seeder = await openSeeder();
    await seeder.supplier("Acme rental");
    await seeder.close();
    await gotoFleet(page, "suppliers");
    await changeArchiveState(page, "ACME RENTAL", "archive", REASON);
    await createSupplierViaUi(page, "acme rental");
    await gotoFleet(page, "suppliers", "archived=1");
    const dialog = await attemptArchiveChange(page, copy.common.archivedTag, "restore", REASON);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.name_taken);
  });

  test("cannot restore a unit whose supplier is archived", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await gotoFleet(page, "suppliers");
    await changeArchiveState(page, "ACME RENTAL", "archive", REASON);
    await gotoFleet(page, "equipment", "archived=1");
    const dialog = await attemptArchiveChange(page, "U-1", "restore", REASON);
    await expect(dialog.getByRole("alert")).toHaveText(copy.errors.fleetParentArchived);
  });

  test("cannot restore a unit whose asset type is archived, and works after restoring the type", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await gotoFleet(page, "asset-types");
    await changeArchiveState(page, "FORKLIFT", "archive", REASON);
    await gotoFleet(page, "equipment", "archived=1");
    const dialog = await attemptArchiveChange(page, "U-1", "restore", REASON);
    await expect(dialog.getByRole("alert")).toHaveText(copy.errors.fleetParentArchived);
    await gotoFleet(page, "asset-types", "archived=1");
    await changeArchiveState(page, "FORKLIFT", "restore", REASON);
    await gotoFleet(page, "equipment", "archived=1");
    await changeArchiveState(page, "U-1", "restore", REASON);
    await gotoFleet(page);
    await expect(rowOf(page, "U-1")).toContainText(copy.common.active);
  });

  test("an archived supplier cannot receive new equipment", async ({ page }) => {
    await seedUnit();
    await gotoFleet(page);
    await changeArchiveState(page, "U-1", "archive", REASON);
    await gotoFleet(page, "suppliers");
    await changeArchiveState(page, "ACME RENTAL", "archive", REASON);
    await gotoFleet(page);
    await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toHaveCount(0);
    await expect(page.getByText(copy.fleet.createFirst)).toBeVisible();
  });

  test("the edit dialog of a unit offers no archived supplier", async ({ page }) => {
    await seedUnit();
    const seeder = await openSeeder();
    await seeder.supplier("Spare rental");
    await seeder.close();
    await gotoFleet(page, "suppliers");
    await changeArchiveState(page, "SPARE RENTAL", "archive", REASON);
    await gotoFleet(page);
    const dialog = await openDialog(page, d.editEquipment.trigger, rowOf(page, "U-1"));
    await expect(dialog.getByLabel(d.equipmentFields.supplierLabel, { exact: true }).getByRole("option")).toHaveText([
      d.equipmentFields.selectSupplier,
      "ACME RENTAL",
    ]);
  });
});

const WRITE_BUTTONS = [d.newSupplier.trigger, d.rename.trigger, d.editEquipment.trigger, d.archive.trigger, d.restore.trigger];

const seedMixedFleet = (): Promise<void> => seedUnit("P-1");

test.describe("fleet permissions: administrator", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(async () => {
    await resetCatalogs();
    await seedMixedFleet();
  });

  test("can write the catalogs but cannot archive or see archived rows", async ({ page }) => {
    await gotoFleet(page, "suppliers", "archived=1");
    await expect(page.getByRole("button", { name: d.newSupplier.trigger })).toBeVisible();
    await expect(rowOf(page, "ACME RENTAL").getByRole("button", { name: d.rename.trigger })).toBeVisible();
    await expect(page.getByRole("button", { name: d.archive.trigger })).toHaveCount(0);
    await expect(page.getByRole("link", { name: copy.fleet.showArchived })).toHaveCount(0);
    await gotoFleet(page);
    await expect(rowOf(page, "P-1").getByRole("button", { name: d.editEquipment.trigger })).toBeVisible();
    await expect(page.getByRole("button", { name: d.archive.trigger })).toHaveCount(0);
  });

  test("sees the Flota entry in the sidebar", async ({ page }) => {
    await gotoFleet(page);
    await expect(page.getByRole("complementary").getByRole("link", { name: copy.nav.fleet })).toBeVisible();
  });
});

test.describe("fleet permissions: fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(async () => {
    await resetCatalogs();
    await seedMixedFleet();
  });

  test("can write, archive and use the archived toggle on every tab", async ({ page }) => {
    await gotoFleet(page);
    await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toBeVisible();
    await expect(rowOf(page, "P-1").getByRole("button", { name: d.archive.trigger })).toBeVisible();
    for (const section of ["equipment", "suppliers", "asset-types"] as const) {
      await gotoFleet(page, section);
      await expect(page.getByRole("link", { name: copy.fleet.showArchived })).toBeVisible();
    }
  });

  test("can create a supplier from the screen", async ({ page }) => {
    await createSupplierViaUi(page, "Analyst supplier");
    await expect(rowOf(page, "ANALYST SUPPLIER")).toBeVisible();
  });
});

test.describe("fleet permissions: viewer", () => {
  test.use({ storageState: storageStatePath("viewer") });
  test.beforeEach(async () => {
    await resetCatalogs();
    await seedMixedFleet();
  });

  test("reads every list but has no write, archive or toggle controls", async ({ page }) => {
    for (const section of ["equipment", "suppliers", "asset-types"] as const) {
      await gotoFleet(page, section);
      await expect(page.getByRole("table")).toBeVisible();
      for (const name of [...WRITE_BUTTONS, d.newAssetType.trigger, d.newEquipment.trigger]) {
        await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
      await expect(page.getByRole("link", { name: copy.fleet.showArchived })).toHaveCount(0);
    }
  });

  test("does not see archived rows even when asking for them in the URL", async ({ page, browser }) => {
    const analyst = await browser.newContext({ storageState: storageStatePath("fleet_analyst") });
    const analystPage = await analyst.newPage();
    await gotoFleet(analystPage);
    await changeArchiveState(analystPage, "P-1", "archive", REASON);
    await analyst.close();
    await gotoFleet(page, "equipment", "archived=1");
    await expect(page.getByText(copy.fleet.emptyEquipment)).toBeVisible();
    await expect(page.getByRole("link", { name: copy.fleet.hideArchived })).toHaveCount(0);
  });
});

for (const role of ["manager", "supervisor"] as const) {
  test.describe(`fleet permissions: ${role} with a limited scope`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(async () => {
      await resetCatalogs();
      await seedMixedFleet();
    });

    test("has no Flota entry and sees the restricted message instead of data", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("complementary").getByRole("link", { name: copy.nav.home })).toBeVisible();
      await expect(page.getByRole("complementary").getByRole("link", { name: copy.nav.fleet })).toHaveCount(0);
      await page.goto("/fleet");
      await expect(page.getByRole("heading", { name: copy.fleet.restrictedTitle })).toBeVisible();
      await expect(page.getByText(copy.fleet.restrictedText)).toBeVisible();
      await expect(page.getByText("P-1")).toHaveCount(0);
      await expect(page.getByRole("table")).toHaveCount(0);
    });
  });
}

test.describe("fleet permissions: anonymous visitor", () => {
  test("is sent to the login page", async ({ page }) => {
    await page.goto("/fleet");
    await expect(page).toHaveURL(/\/login$/);
  });
});
