import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import { createAssetTypeViaUi, createSupplierViaUi, gotoFleet, openDialog, rowOf } from "../support/fleet-flows";
import { drawerLinks, expectNoHorizontalScroll, openDrawer } from "../support/mobile-flows";
import { ROLE_KEYS, storageStatePath, type RoleKey } from "../support/world";

const d = copy.dialogs;
const g = copy.fleet.guidance;
const FLEET_LABELS = [copy.nav.fleet, copy.nav.suppliers, copy.nav.assetTypes];

/** Company-wide fleet readers get the catalog tabs, and so their sidebar entries; scoped readers get Flota only. */
const WITH_CATALOGS: readonly RoleKey[] = ["admin", "fleet_analyst", "viewer"];
const WRITERS: readonly RoleKey[] = ["admin", "fleet_analyst"];

const sidebar = (page: Page): Locator => page.getByRole("complementary");
const entry = (page: Page, label: string): Locator => sidebar(page).getByRole("link", { name: label, exact: true });
const guidance = (page: Page): Locator => page.getByRole("region", { name: g.title });
const checklist = (page: Page): Locator => guidance(page).getByRole("list", { name: g.listLabel });
const newEquipmentButton = (page: Page): Locator => page.getByRole("button", { name: d.newEquipment.trigger, exact: true });
const SECTIONS = [
  { path: "/fleet", label: copy.nav.fleet },
  { path: "/fleet?tab=suppliers", label: copy.nav.suppliers },
  { path: "/fleet?tab=asset-types", label: copy.nav.assetTypes },
] as const;

async function expectOnlyCurrent(page: Page, label: string): Promise<void> {
  await expect(entry(page, label)).toHaveAttribute("aria-current", "page");
  await expect(sidebar(page).locator("[aria-current]")).toHaveCount(1);
}

test.beforeEach(resetCatalogs);

for (const role of ROLE_KEYS) {
  test.describe(`fleet entries in the sidebar as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    const hasCatalogs = WITH_CATALOGS.includes(role);

    test(`${hasCatalogs ? "lists" : "does not list"} Proveedores and Tipos de equipo next to Flota`, async ({ page }) => {
      await page.goto("/");
      await expect(entry(page, copy.nav.fleet)).toBeVisible();
      await expect(entry(page, copy.nav.suppliers)).toHaveCount(hasCatalogs ? 1 : 0);
      await expect(entry(page, copy.nav.assetTypes)).toHaveCount(hasCatalogs ? 1 : 0);
    });
  });
}

test.describe("fleet entries: navigation and current marker", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("lists the fleet entries together, in order, under Principal", async ({ page }) => {
    await page.goto("/");
    const links = sidebar(page).getByRole("list").first().getByRole("link");
    await expect(links).toHaveText([copy.nav.home, ...FLEET_LABELS]);
  });

  test("Proveedores opens the suppliers tab and is the only current entry", async ({ page }) => {
    await page.goto("/");
    await entry(page, copy.nav.suppliers).click();
    await expect(page).toHaveURL(/\/fleet\?tab=suppliers$/);
    await expect(page.getByRole("button", { name: d.newSupplier.trigger })).toBeVisible();
    await expectOnlyCurrent(page, copy.nav.suppliers);
    await expect(page.locator(".topbar-title")).toHaveText(copy.nav.suppliers);
  });

  test("Tipos de equipo opens the asset types tab and is the only current entry", async ({ page }) => {
    await page.goto("/");
    await entry(page, copy.nav.assetTypes).click();
    await expect(page).toHaveURL(/\/fleet\?tab=asset-types$/);
    await expect(page.getByRole("button", { name: d.newAssetType.trigger })).toBeVisible();
    await expectOnlyCurrent(page, copy.nav.assetTypes);
    await expect(page.locator(".topbar-title")).toHaveText(copy.nav.assetTypes);
  });

  test("Flota goes back to the equipment tab and is the only current entry", async ({ page }) => {
    await page.goto("/fleet?tab=suppliers");
    await entry(page, copy.nav.fleet).click();
    await expect(page).toHaveURL(/\/fleet$/);
    await expectOnlyCurrent(page, copy.nav.fleet);
    await expect(page.locator(".topbar-title")).toHaveText(copy.nav.fleet);
  });

  test("the current entry follows the sidebar", async ({ page }) => {
    await gotoFleet(page, "equipment");
    await expectOnlyCurrent(page, copy.nav.fleet);
    await entry(page, copy.nav.suppliers).click();
    await expectOnlyCurrent(page, copy.nav.suppliers);
    await entry(page, copy.nav.assetTypes).click();
    await expectOnlyCurrent(page, copy.nav.assetTypes);
  });

  for (const { path, label } of SECTIONS) {
    test(`${path} has no tab selector and its heading matches the sidebar entry`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: label, exact: true })).toBeVisible();
      await expect(page.locator("nav.tabs")).toHaveCount(0);
      await expectOnlyCurrent(page, label);
    });
  }

  test("an unknown tab value shows the equipment tab and marks Flota", async ({ page }) => {
    await page.goto("/fleet?tab=nonsense");
    await expectOnlyCurrent(page, copy.nav.fleet);
  });

  test("Flota is current on an equipment detail page", async ({ page }) => {
    const seeder = await openSeeder();
    const supplierId = await seeder.supplier("Nav rental");
    const assetTypeId = await seeder.assetType("Nav lift");
    await seeder.equipment({ supplierId, assetTypeId, internalCode: "NAV-1" });
    await seeder.close();
    await gotoFleet(page, "equipment");
    await rowOf(page, "NAV-1").getByRole("link", { name: "NAV-1" }).click();
    await expect(page).toHaveURL(/\/fleet\/equipment\//);
    await expectOnlyCurrent(page, copy.nav.fleet);
    await expect(page.locator(".topbar").getByRole("link", { name: copy.fleet.detail.back })).toBeVisible();
    await expect(page.locator(".topbar-title")).toHaveCount(0);
  });
});

for (const role of WRITERS) {
  test.describe(`guidance to register an equipment as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test("from an empty application lists both prerequisites as missing, with a link for each", async ({ page }) => {
      await gotoFleet(page, "equipment");
      await expect(guidance(page)).toContainText(g.text);
      await expect(checklist(page).getByRole("listitem")).toHaveText([
        new RegExp(g.supplierMissing, "u"),
        new RegExp(g.assetTypeMissing, "u"),
      ]);
      await expect(guidance(page).getByRole("link", { name: g.createSupplier })).toBeVisible();
      await expect(guidance(page).getByRole("link", { name: g.createAssetType })).toBeVisible();
      await expect(newEquipmentButton(page)).toHaveCount(0);
    });

    test("the supplier link leads to the suppliers tab, where the supplier can be created", async ({ page }) => {
      await gotoFleet(page, "equipment");
      await guidance(page).getByRole("link", { name: g.createSupplier }).click();
      await expect(page).toHaveURL(/\/fleet\?tab=suppliers$/);
      await expectOnlyCurrent(page, copy.nav.suppliers);
      await expect(page.getByRole("button", { name: d.newSupplier.trigger })).toBeVisible();
    });

    test("the asset type link leads to the asset types tab", async ({ page }) => {
      await gotoFleet(page, "equipment");
      await guidance(page).getByRole("link", { name: g.createAssetType }).click();
      await expect(page).toHaveURL(/\/fleet\?tab=asset-types$/);
      await expectOnlyCurrent(page, copy.nav.assetTypes);
    });

    test("creating a supplier marks that step done and leaves only the asset type missing", async ({ page }) => {
      await createSupplierViaUi(page, "Guide supplier");
      await gotoFleet(page, "equipment");
      await expect(checklist(page).getByRole("listitem")).toHaveText([
        new RegExp(g.supplierDone, "u"),
        new RegExp(g.assetTypeMissing, "u"),
      ]);
      await expect(guidance(page).getByRole("link", { name: g.createSupplier })).toHaveCount(0);
      await expect(guidance(page).getByRole("link", { name: g.createAssetType })).toBeVisible();
      await expect(newEquipmentButton(page)).toHaveCount(0);
    });

    test("creating only an asset type leaves only the supplier missing", async ({ page }) => {
      await createAssetTypeViaUi(page, { name: "Guide type" });
      await gotoFleet(page, "equipment");
      await expect(checklist(page).getByRole("listitem")).toHaveText([
        new RegExp(g.supplierMissing, "u"),
        new RegExp(g.assetTypeDone, "u"),
      ]);
      await expect(guidance(page).getByRole("link", { name: g.createAssetType })).toHaveCount(0);
      await expect(newEquipmentButton(page)).toHaveCount(0);
    });

    test("with both prerequisites the guidance is gone and Nuevo equipo appears", async ({ page }) => {
      await createSupplierViaUi(page, "Both supplier");
      await createAssetTypeViaUi(page, { name: "Both type" });
      await gotoFleet(page, "equipment");
      await expect(guidance(page)).toHaveCount(0);
      await expect(newEquipmentButton(page)).toBeVisible();
    });
  });
}

test.describe("guidance is not shown to people who cannot create", () => {
  test.use({ storageState: storageStatePath("viewer") });

  test("a viewer sees the plain empty state with no guidance and no creation control", async ({ page }) => {
    await gotoFleet(page, "equipment");
    await expect(page.getByText(copy.fleet.emptyEquipment)).toBeVisible();
    await expect(guidance(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: g.createSupplier })).toHaveCount(0);
    await expect(page.getByRole("link", { name: g.createAssetType })).toHaveCount(0);
    await expect(newEquipmentButton(page)).toHaveCount(0);
  });

  test("a viewer sees the empty catalog tabs without creation buttons", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    await expect(page.getByText(copy.fleet.emptySuppliers)).toBeVisible();
    await expect(page.getByRole("button", { name: d.newSupplier.trigger })).toHaveCount(0);
    await gotoFleet(page, "asset-types");
    await expect(page.getByText(copy.fleet.emptyAssetTypes)).toBeVisible();
    await expect(page.getByRole("button", { name: d.newAssetType.trigger })).toHaveCount(0);
  });
});

test.describe("empty catalog tabs show the creation button", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });

  test("an empty suppliers tab offers Nuevo proveedor next to its explanation, once", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    const empty = page.getByRole("status").filter({ hasText: copy.fleet.emptySuppliers });
    await expect(empty.getByRole("button", { name: d.newSupplier.trigger })).toBeVisible();
    await expect(page.getByRole("button", { name: d.newSupplier.trigger })).toHaveCount(1);
  });

  test("an empty asset types tab offers Nuevo tipo de equipo next to its explanation, once", async ({ page }) => {
    await gotoFleet(page, "asset-types");
    const empty = page.getByRole("status").filter({ hasText: copy.fleet.emptyAssetTypes });
    await expect(empty.getByRole("button", { name: d.newAssetType.trigger })).toBeVisible();
    await expect(page.getByRole("button", { name: d.newAssetType.trigger })).toHaveCount(1);
  });

  test("the button of the empty state opens the creation dialog", async ({ page }) => {
    await gotoFleet(page, "suppliers");
    const empty = page.getByRole("status").filter({ hasText: copy.fleet.emptySuppliers });
    const dialog = await openDialog(page, d.newSupplier.trigger, empty);
    await expect(dialog.getByRole("heading", { name: d.newSupplier.title })).toBeVisible();
  });

  test("once there is a supplier the button moves back to the page header", async ({ page }) => {
    await createSupplierViaUi(page, "Header supplier");
    await expect(page.getByRole("button", { name: d.newSupplier.trigger })).toHaveCount(1);
    await expect(page.getByText(copy.fleet.emptySuppliers)).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });

  test("@mobile the menu lists the fleet entries and Proveedores opens its tab", async ({ page }) => {
    await page.goto("/");
    await openDrawer(page);
    await expect(drawerLinks(page)).toHaveText([copy.nav.home, ...FLEET_LABELS, copy.nav.organization]);
    await drawerLinks(page).filter({ hasText: copy.nav.suppliers }).tap();
    await expect(page).toHaveURL(/\/fleet\?tab=suppliers$/);
    await expect(page.locator(".topbar-title")).toHaveText(copy.nav.suppliers);
  });

  test("@mobile the guidance fits the screen without sideways scrolling", async ({ page }) => {
    await gotoFleet(page, "equipment");
    await expect(guidance(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
    const box = await guidance(page).boundingBox();
    const link = await guidance(page).getByRole("link", { name: g.createAssetType }).boundingBox();
    const width = page.viewportSize()?.width ?? 0;
    expect(box).not.toBeNull();
    expect(link).not.toBeNull();
    expect((link?.x ?? 0) + (link?.width ?? 0)).toBeLessThanOrEqual(width);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });
});
