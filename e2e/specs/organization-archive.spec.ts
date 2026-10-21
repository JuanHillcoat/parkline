import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs, type Seeder } from "../support/data";
import {
  archiveAsOwner,
  archiveButton,
  archiveOrRestore,
  confirmArchiveOrRestore,
  archivedRowOf,
  buttonNamed,
  createDivisionInUi,
  createOperationInUi,
  createSiteInUi,
  dialogs,
  divisionHeader,
  fillOperation,
  messages,
  openDialog,
  restoreButton,
  rowOf,
  submitDialog,
} from "../support/organization-flows";
import { WORLD_ORG, storageStatePath } from "../support/world";

const t = copy.organization;
const REASON = "Cargada por error";

async function seed<T>(build: (seeder: Seeder) => Promise<T>): Promise<T> {
  const seeder = await openSeeder();
  try {
    return await build(seeder);
  } finally {
    await seeder.close();
  }
}

type Ids = { division: string; site: string; operation: string };

/** One division with one site and one operation, all active, named after `label`. */
const seedTree = (label: string, costCenter: string): Promise<Ids> =>
  seed(async (seeder) => {
    const division = await seeder.division(`Div ${label}`);
    const site = await seeder.site(`Sitio ${label}`);
    const operation = await seeder.operation({ division, site, name: `Op ${label}`, costCenter });
    return { division, site, operation };
  });

const names = (label: string) => ({
  division: `DIV ${label.toUpperCase()}`,
  site: `SITIO ${label.toUpperCase()}`,
  operation: `OP ${label.toUpperCase()}`,
});

test.describe("archiving and restoring as the fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test.describe("operations", () => {
    test("archiving removes the row from the list and frees its name and cost center", async ({ page }) => {
      await seedTree("uno", "7001");
      await page.goto("/organization");
      const n = names("uno");
      const dialog = await archiveOrRestore(page, archiveButton(rowOf(page, n.operation)), "archive", REASON);
      await expect(dialog).toBeHidden();
      await expect(rowOf(page, n.operation)).toHaveCount(0);
      await expect(divisionHeader(page, n.division)).toContainText(t.operationCount(0));
      await createOperationInUi(page, { name: "op uno", division: n.division, site: n.site, costCenter: "7001" });
      await expect(rowOf(page, n.operation)).toContainText("7001");
    });

    test("the archive dialog explains the effect and asks for a reason", async ({ page }) => {
      await seedTree("dos", "7002");
      await page.goto("/organization");
      const n = names("dos");
      const dialog = await openDialog(page, archiveButton(rowOf(page, n.operation)));
      await expect(dialog.getByRole("heading", { name: dialogs.archive.title(n.operation) })).toBeVisible();
      await expect(dialog.getByText(dialogs.archive.description)).toBeVisible();
      await expect(dialog.getByLabel(copy.common.reason)).toHaveAttribute("placeholder", dialogs.archive.reasonPlaceholder);
    });

    test("refuses a reason made only of spaces and keeps the row", async ({ page }) => {
      await seedTree("tres", "7003");
      await page.goto("/organization");
      const n = names("tres");
      const dialog = await archiveOrRestore(page, archiveButton(rowOf(page, n.operation)), "archive", "    ");
      await expect(dialog.getByRole("alert")).toHaveText(messages.reason_required);
      await expect(dialog.getByLabel(copy.common.reason)).toHaveValue("    ");
      await page.keyboard.press("Escape");
      await expect(rowOf(page, n.operation)).toBeVisible();
    });

    test("refuses a reason longer than 500 characters", async ({ page }) => {
      await seedTree("cuatro", "7004");
      await page.goto("/organization");
      const dialog = await archiveOrRestore(page, archiveButton(rowOf(page, names("cuatro").operation)), "archive", "x".repeat(501));
      await expect(dialog.getByRole("alert")).toHaveText(messages.reason_too_long);
    });

    test("the browser blocks an empty reason", async ({ page }) => {
      await seedTree("cinco", "7005");
      await page.goto("/organization");
      const dialog = await openDialog(page, archiveButton(rowOf(page, names("cinco").operation)));
      await submitDialog(dialog, dialogs.archive.submit);
      await expect(dialog.getByLabel(copy.common.reason)).toHaveJSProperty("validity.valueMissing", true);
      await expect(dialog.getByRole("alert")).toHaveCount(0);
    });

    test("an archived operation shows only Reactivar in the archived view", async ({ page }) => {
      await seedTree("seis", "7006");
      await page.goto("/organization");
      const n = names("seis");
      await confirmArchiveOrRestore(page, archiveButton(rowOf(page, n.operation)), "archive", REASON);
      await page.goto("/organization?archived=1");
      const row = archivedRowOf(page, n.operation);
      await expect(row).toContainText(copy.common.archivedTag);
      await expect(restoreButton(row)).toBeVisible();
      await expect(buttonNamed(row, dialogs.editOperation.trigger)).toHaveCount(0);
      await expect(buttonNamed(row, dialogs.rename.trigger)).toHaveCount(0);
      await expect(archiveButton(row)).toHaveCount(0);
    });

    test("restoring brings the operation back to the default list", async ({ page }) => {
      const ids = await seedTree("siete", "7007");
      await archiveAsOwner("operations", ids.operation);
      await page.goto("/organization?archived=1");
      const n = names("siete");
      const dialog = await archiveOrRestore(page, restoreButton(archivedRowOf(page, n.operation)), "restore", "Era correcta");
      await expect(dialog).toBeHidden();
      await expect(archivedRowOf(page, n.operation)).toHaveCount(0);
      await page.goto("/organization");
      await expect(rowOf(page, n.operation)).toContainText("7007");
    });

    test("restore is refused while its division is archived", async ({ page }) => {
      const ids = await seedTree("ocho", "7008");
      await archiveAsOwner("operations", ids.operation);
      await archiveAsOwner("business_units", ids.division);
      await page.goto("/organization?archived=1");
      const dialog = await archiveOrRestore(page, restoreButton(archivedRowOf(page, names("ocho").operation)), "restore", "Intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.parent_archived);
    });

    test("restore is refused while its site is archived", async ({ page }) => {
      const ids = await seedTree("nueve", "7009");
      await archiveAsOwner("operations", ids.operation);
      await archiveAsOwner("sites", ids.site);
      await page.goto("/organization?archived=1");
      const dialog = await archiveOrRestore(page, restoreButton(archivedRowOf(page, names("nueve").operation)), "restore", "Intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.parent_archived);
    });

    test("restore is refused when the name was reused in the meantime", async ({ page }) => {
      const ids = await seedTree("diez", "7010");
      await archiveAsOwner("operations", ids.operation);
      await seed((seeder) => seeder.operation({ division: ids.division, site: ids.site, name: "Op diez", costCenter: "7110" }));
      await page.goto("/organization?archived=1");
      const dialog = await archiveOrRestore(page, restoreButton(archivedRowOf(page, names("diez").operation)), "restore", "Intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
    });

    test("restore is refused when the cost center was reused in the meantime", async ({ page }) => {
      const ids = await seedTree("once", "7011");
      await archiveAsOwner("operations", ids.operation);
      await seed((seeder) => seeder.operation({ division: ids.division, site: ids.site, name: "Otra distinta", costCenter: "7011" }));
      await page.goto("/organization?archived=1");
      const dialog = await archiveOrRestore(page, restoreButton(archivedRowOf(page, names("once").operation)), "restore", "Intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.cost_center_taken);
    });
  });

  test.describe("sites and divisions", () => {
    test("archiving a site without operations frees its name", async ({ page }) => {
      await seed((seeder) => seeder.site("Patio libre"));
      await page.goto("/organization");
      await confirmArchiveOrRestore(page, archiveButton(rowOf(page, "PATIO LIBRE")), "archive", REASON);
      await expect(rowOf(page, "PATIO LIBRE")).toHaveCount(0);
      await createSiteInUi(page, "patio libre");
      await expect(rowOf(page, "PATIO LIBRE")).toBeVisible();
    });

    test("archiving a division without operations frees its name", async ({ page }) => {
      await seed((seeder) => seeder.division("Area vacia"));
      await page.goto("/organization");
      await confirmArchiveOrRestore(page, archiveButton(divisionHeader(page, "AREA VACIA")), "archive", REASON);
      await expect(divisionHeader(page, "AREA VACIA")).toHaveCount(0);
      await createDivisionInUi(page, "area vacia");
      await expect(divisionHeader(page, "AREA VACIA")).toBeVisible();
    });

    test("a division with active operations cannot be archived until they are archived", async ({ page }) => {
      await seedTree("doce", "7012");
      await page.goto("/organization");
      const n = names("doce");
      const dialog = await archiveOrRestore(page, archiveButton(divisionHeader(page, n.division)), "archive", REASON);
      await expect(dialog.getByRole("alert")).toHaveText(messages.has_active_operations);
      await page.keyboard.press("Escape");
      await confirmArchiveOrRestore(page, archiveButton(rowOf(page, n.operation)), "archive", REASON);
      await confirmArchiveOrRestore(page, archiveButton(divisionHeader(page, n.division)), "archive", REASON);
      await expect(divisionHeader(page, n.division)).toHaveCount(0);
    });

    test("a site with active operations cannot be archived until they are archived", async ({ page }) => {
      await seedTree("trece", "7013");
      await page.goto("/organization");
      const n = names("trece");
      const dialog = await archiveOrRestore(page, archiveButton(rowOf(page, n.site)), "archive", REASON);
      await expect(dialog.getByRole("alert")).toHaveText(messages.has_active_operations);
      await page.keyboard.press("Escape");
      await confirmArchiveOrRestore(page, archiveButton(rowOf(page, n.operation)), "archive", REASON);
      await confirmArchiveOrRestore(page, archiveButton(rowOf(page, n.site)), "archive", REASON);
      await expect(rowOf(page, n.site)).toHaveCount(0);
    });

    test("an archived division and site offer only Reactivar and can be restored", async ({ page }) => {
      const ids = await seedTree("catorce", "7014");
      await archiveAsOwner("operations", ids.operation);
      await archiveAsOwner("business_units", ids.division);
      await archiveAsOwner("sites", ids.site);
      await page.goto("/organization?archived=1");
      const n = names("catorce");
      const header = divisionHeader(page, n.division);
      await expect(header).toContainText(copy.common.archivedTag);
      await expect(buttonNamed(header, dialogs.rename.trigger)).toHaveCount(0);
      await confirmArchiveOrRestore(page, restoreButton(header), "restore", "Era correcta");
      await confirmArchiveOrRestore(page, restoreButton(archivedRowOf(page, n.site)), "restore", "Era correcta");
      await confirmArchiveOrRestore(page, restoreButton(archivedRowOf(page, n.operation)), "restore", "Era correcta");
      await page.goto("/organization");
      await expect(rowOf(page, n.operation)).toBeVisible();
      await expect(rowOf(page, n.site)).toBeVisible();
    });

    test("restoring a division is refused when its name was taken meanwhile", async ({ page }) => {
      const id = await seed((seeder) => seeder.division("Nombre usado"));
      await archiveAsOwner("business_units", id);
      await seed((seeder) => seeder.division("nombre usado"));
      await page.goto("/organization?archived=1");
      const header = page.locator("header.group-head").filter({ has: page.getByText(copy.common.archivedTag) });
      const dialog = await archiveOrRestore(page, restoreButton(header), "restore", "Intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
    });
  });

  test.describe("archived view and stale pages", () => {
    test("the toggle shows archived rows and the link switches its text", async ({ page }) => {
      const ids = await seedTree("quince", "7015");
      await archiveAsOwner("operations", ids.operation);
      await page.goto("/organization");
      const n = names("quince");
      await expect(rowOf(page, n.operation)).toHaveCount(0);
      await page.getByRole("link", { name: t.showArchived }).click();
      await expect(page).toHaveURL(/\/organization\?archived=1$/);
      await expect(archivedRowOf(page, n.operation)).toBeVisible();
      await page.getByRole("link", { name: t.hideArchived }).click();
      await expect(page).toHaveURL(/\/organization$/);
      await expect(archivedRowOf(page, n.operation)).toHaveCount(0);
    });

    test("archiving a row that another page already archived says to reload", async ({ page, context }) => {
      await seedTree("dieciseis", "7016");
      await page.goto("/organization");
      const second = await context.newPage();
      await second.goto("/organization");
      const n = names("dieciseis");
      await confirmArchiveOrRestore(second, archiveButton(rowOf(second, n.operation)), "archive", REASON);
      await expect(rowOf(second, n.operation)).toHaveCount(0);
      const dialog = await archiveOrRestore(page, archiveButton(rowOf(page, n.operation)), "archive", "Segundo intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.already_archived);
    });

    test("restoring a row that another page already restored says it is already active", async ({ page, context }) => {
      const ids = await seedTree("diecisiete", "7017");
      await archiveAsOwner("operations", ids.operation);
      await page.goto("/organization?archived=1");
      const second = await context.newPage();
      await second.goto("/organization?archived=1");
      const n = names("diecisiete");
      await confirmArchiveOrRestore(second, restoreButton(archivedRowOf(second, n.operation)), "restore", REASON);
      await expect(archivedRowOf(second, n.operation)).toHaveCount(0);
      const dialog = await archiveOrRestore(page, restoreButton(archivedRowOf(page, n.operation)), "restore", "Segundo intento");
      await expect(dialog.getByRole("alert")).toHaveText(messages.not_archived);
    });

    test("editing an operation archived by another page is refused", async ({ page, context }) => {
      await seedTree("dieciocho", "7018");
      await page.goto("/organization");
      const second = await context.newPage();
      await second.goto("/organization");
      const n = names("dieciocho");
      await confirmArchiveOrRestore(second, archiveButton(rowOf(second, n.operation)), "archive", REASON);
      await expect(rowOf(second, n.operation)).toHaveCount(0);
      const dialog = await openDialog(page, buttonNamed(rowOf(page, n.operation), dialogs.editOperation.trigger));
      await fillOperation(dialog, { costCenter: "7118", reason: "Editar tarde" });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.archived);
    });
  });
});

test.describe("archive controls are hidden from roles without catalog.archive", () => {
  test.beforeEach(resetCatalogs);

  async function seedArchivedSite(): Promise<void> {
    const id = await seed((seeder) => seeder.site("Sitio oculto"));
    await archiveAsOwner("sites", id);
  }

  async function expectNoArchiveControls(page: Page, scope: Locator): Promise<void> {
    await expect(scope.getByRole("button", { name: dialogs.archive.trigger })).toHaveCount(0);
    await expect(scope.getByRole("button", { name: dialogs.restore.trigger })).toHaveCount(0);
    await expect(page.getByRole("link", { name: t.showArchived })).toHaveCount(0);
  }

  test.describe("systems administrator", () => {
    test.use({ storageState: storageStatePath("admin") });

    test("sees create and edit buttons but no archive button or archived toggle", async ({ page }) => {
      await page.goto("/organization");
      await expect(buttonNamed(page.getByRole("main"), dialogs.newDivision.trigger)).toBeVisible();
      await expect(buttonNamed(rowOf(page, WORLD_ORG.operation), dialogs.editOperation.trigger)).toBeVisible();
      await expectNoArchiveControls(page, page.getByRole("main"));
    });

    test("ignores ?archived=1 and keeps archived rows hidden", async ({ page }) => {
      await seedArchivedSite();
      await page.goto("/organization?archived=1");
      await expect(rowOf(page, WORLD_ORG.site)).toBeVisible();
      await expect(page.getByRole("rowheader", { name: /SITIO OCULTO/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: t.hideArchived })).toHaveCount(0);
    });
  });

  test.describe("viewer", () => {
    test.use({ storageState: storageStatePath("viewer") });

    test("sees no archive controls and no archived rows", async ({ page }) => {
      await seedArchivedSite();
      await page.goto("/organization?archived=1");
      await expect(rowOf(page, WORLD_ORG.site)).toBeVisible();
      await expect(page.getByRole("rowheader", { name: /SITIO OCULTO/ })).toHaveCount(0);
      await expectNoArchiveControls(page, page.getByRole("main"));
    });
  });
});
