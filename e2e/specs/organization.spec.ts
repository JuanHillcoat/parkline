import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs, type Seeder } from "../support/data";
import {
  archiveAsOwner,
  buttonNamed,
  createDivisionInUi,
  createOperationInUi,
  createSiteInUi,
  dialogs,
  divisionHeader,
  fillOperation,
  messages,
  openDialog,
  rowOf,
  skipBrowserValidation,
  submitDialog,
} from "../support/organization-flows";
import { WORLD_ORG, readWorld, storageStatePath } from "../support/world";

const t = copy.organization;

/** Opens a seeder, runs the callback and always closes the seeder. */
async function seed<T>(build: (seeder: Seeder) => Promise<T>): Promise<T> {
  const seeder = await openSeeder();
  try {
    return await build(seeder);
  } finally {
    await seeder.close();
  }
}

const mainArea = (page: Page): Locator => page.getByRole("main");

test.describe("organization page as the systems administrator", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);
  test.beforeEach(async ({ page }) => {
    await page.goto("/organization");
  });

  test("lists the world's division, operation and site", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
    await expect(divisionHeader(page, WORLD_ORG.division)).toContainText(t.operationCount(1));
    const operation = rowOf(page, WORLD_ORG.operation);
    await expect(operation).toContainText(WORLD_ORG.costCenter);
    await expect(operation).toContainText(WORLD_ORG.site);
    await expect(rowOf(page, WORLD_ORG.site)).toBeVisible();
  });

  test.describe("creating rows", () => {
    test("creates a division, stored in uppercase with its accents and collapsed spaces", async ({ page }) => {
      await createDivisionInUi(page, "  Logística   norte ");
      await expect(divisionHeader(page, "LOGÍSTICA NORTE")).toContainText(t.operationCount(0));
      await expect(page.getByText(t.noOperations)).toBeVisible();
    });

    test("creates a site that starts with no operations", async ({ page }) => {
      await createSiteInUi(page, "Puerto seco");
      await expect(rowOf(page, "PUERTO SECO").getByRole("cell", { name: "0", exact: true })).toBeVisible();
    });

    test("creates an operation under a division at a site with its cost center", async ({ page }) => {
      await seed(async (seeder) => {
        await seeder.division("Minería");
        await seeder.site("Mina alta");
      });
      await page.reload();
      await createOperationInUi(page, { name: "Carga pesada", division: "MINERÍA", site: "MINA ALTA", costCenter: "0050" });
      const row = rowOf(page, "CARGA PESADA");
      await expect(row).toContainText("0050");
      await expect(row).toContainText("MINA ALTA");
      await expect(divisionHeader(page, "MINERÍA")).toContainText(t.operationCount(1));
      await expect(rowOf(page, "MINA ALTA").getByRole("cell", { name: "1", exact: true })).toBeVisible();
    });

    test("keeps the leading zeros of a cost center", async ({ page }) => {
      await createOperationInUi(page, {
        name: "Ceros", division: WORLD_ORG.division, site: WORLD_ORG.site, costCenter: "0007",
      });
      await expect(rowOf(page, "CEROS")).toContainText("0007");
    });

    test("allows the same operation name in two different divisions", async ({ page }) => {
      await seed(async (seeder) => {
        const other = await seeder.division("Otra area");
        const site = await seeder.site("Sitio compartido");
        await seeder.operation({ division: other, site, name: "Patio", costCenter: "1001" });
      });
      await page.reload();
      await createOperationInUi(page, { name: "Patio", division: WORLD_ORG.division, site: "SITIO COMPARTIDO", costCenter: "1002" });
      await expect(page.getByRole("rowheader", { name: "PATIO", exact: true })).toHaveCount(2);
    });

    test("allows two operations to share one site", async ({ page }) => {
      await createOperationInUi(page, {
        name: "Segunda", division: WORLD_ORG.division, site: WORLD_ORG.site, costCenter: "2002",
      });
      await expect(rowOf(page, WORLD_ORG.site).getByRole("cell", { name: "2", exact: true })).toBeVisible();
    });
  });

  test.describe("name rules", () => {
    test("rejects a division whose name only differs in case and accents from another", async ({ page }) => {
      await seed((seeder) => seeder.division("Logística"));
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(page.getByRole("main"), dialogs.newDivision.trigger));
      await dialog.getByLabel(dialogs.newDivision.nameLabel).fill("LOGISTICA");
      await submitDialog(dialog, dialogs.newDivision.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
      await expect(divisionHeader(page, "LOGÍSTICA")).toHaveCount(1);
    });

    test("rejects a site whose name only differs in case and accents from another", async ({ page }) => {
      await seed((seeder) => seeder.site("Estación norte"));
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newSite.trigger));
      await dialog.getByLabel(dialogs.newSite.nameLabel).fill("estacion norte");
      await submitDialog(dialog, dialogs.newSite.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
    });

    test("rejects an operation name already used inside the same division", async ({ page }) => {
      await seed(async (seeder) => {
        const site = await seeder.site("Sitio uno");
        await seeder.operation({ division: readWorld().ids.division, site, name: "Báscula", costCenter: "3001" });
      });
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newOperation.trigger));
      await fillOperation(dialog, { name: "bascula", division: WORLD_ORG.division, site: "SITIO UNO", costCenter: "3002" });
      await submitDialog(dialog, dialogs.newOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
    });

    test("rejects a name made only of spaces", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newDivision.trigger));
      await dialog.getByLabel(dialogs.newDivision.nameLabel).fill("     ");
      await submitDialog(dialog, dialogs.newDivision.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_name);
    });

    test("rejects a name longer than 120 characters", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newSite.trigger));
      await dialog.getByLabel(dialogs.newSite.nameLabel).fill("X".repeat(121));
      await submitDialog(dialog, dialogs.newSite.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_name);
    });

    test("the browser blocks an empty name before reaching the server", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newDivision.trigger));
      await submitDialog(dialog, dialogs.newDivision.submit);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await expect(dialog.getByLabel(dialogs.newDivision.nameLabel)).toHaveJSProperty("validity.valueMissing", true);
    });
  });

  test.describe("cost center rules", () => {
    for (const invalid of ["12", "12a4", "ABCD"]) {
      test(`rejects the cost center "${invalid}" with the four-digit message`, async ({ page }) => {
        const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newOperation.trigger));
        await skipBrowserValidation(dialog);
        await fillOperation(dialog, { name: "Invalida", division: WORLD_ORG.division, site: WORLD_ORG.site, costCenter: invalid });
        await submitDialog(dialog, dialogs.newOperation.submit);
        await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_cost_center);
      });
    }

    test("the browser itself flags a three-digit cost center before submitting", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newOperation.trigger));
      await fillOperation(dialog, { name: "Corta", division: WORLD_ORG.division, site: WORLD_ORG.site, costCenter: "123" });
      await submitDialog(dialog, dialogs.newOperation.submit);
      await expect(dialog.getByLabel(dialogs.newOperation.costCenterLabel)).toHaveJSProperty("validity.patternMismatch", true);
      await expect(dialog.getByRole("alert")).toHaveCount(0);
    });

    test("the cost center field only accepts four characters", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newOperation.trigger));
      await expect(dialog.getByLabel(dialogs.newOperation.costCenterLabel)).toHaveAttribute("maxlength", "4");
    });

    test("rejects a cost center already used by another operation", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newOperation.trigger));
      await fillOperation(dialog, { name: "Repetida", division: WORLD_ORG.division, site: WORLD_ORG.site, costCenter: WORLD_ORG.costCenter });
      await submitDialog(dialog, dialogs.newOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.cost_center_taken);
    });
  });

  test.describe("renaming without a reason", () => {
    test("renames a division and shows the new name in uppercase", async ({ page }) => {
      await seed((seeder) => seeder.division("Viejo nombre"));
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(divisionHeader(page, "VIEJO NOMBRE"), dialogs.rename.trigger));
      await expect(dialog.getByLabel(dialogs.rename.nameLabel)).toHaveValue("VIEJO NOMBRE");
      await dialog.getByLabel(dialogs.rename.nameLabel).fill("nombre nuevo");
      await expect(dialog.getByLabel(copy.common.reason)).toHaveCount(0);
      await submitDialog(dialog, dialogs.rename.submit);
      await expect(dialog).toBeHidden();
      await expect(divisionHeader(page, "NOMBRE NUEVO")).toBeVisible();
      await expect(divisionHeader(page, "VIEJO NOMBRE")).toHaveCount(0);
    });

    test("renames a site", async ({ page }) => {
      await seed((seeder) => seeder.site("Sitio viejo"));
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(rowOf(page, "SITIO VIEJO"), dialogs.rename.trigger));
      await dialog.getByLabel(dialogs.rename.nameLabel).fill("sitio nuevo");
      await submitDialog(dialog, dialogs.rename.submit);
      await expect(rowOf(page, "SITIO NUEVO")).toBeVisible();
    });

    test("renames an operation without a reason", async ({ page }) => {
      await seed(async (seeder) => {
        const site = await seeder.site("Sitio de op");
        await seeder.operation({ division: readWorld().ids.division, site, name: "Op vieja", costCenter: "1500" });
      });
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(rowOf(page, "OP VIEJA"), dialogs.rename.trigger));
      await dialog.getByLabel(dialogs.rename.nameLabel).fill("op nueva");
      await submitDialog(dialog, dialogs.rename.submit);
      await expect(rowOf(page, "OP NUEVA")).toContainText("1500");
    });

    test("rejects renaming to a name another division already uses, ignoring accents", async ({ page }) => {
      await seed(async (seeder) => {
        await seeder.division("Ámbar");
        await seeder.division("Rojo");
      });
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(divisionHeader(page, "ROJO"), dialogs.rename.trigger));
      await dialog.getByLabel(dialogs.rename.nameLabel).fill("ambar");
      await submitDialog(dialog, dialogs.rename.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
      await expect(dialog.getByLabel(dialogs.rename.nameLabel)).toHaveValue("ambar");
    });

    test("rejects renaming a site to a blank name", async ({ page }) => {
      await seed((seeder) => seeder.site("Para renombrar"));
      await page.reload();
      const dialog = await openDialog(page, buttonNamed(rowOf(page, "PARA RENOMBRAR"), dialogs.rename.trigger));
      await dialog.getByLabel(dialogs.rename.nameLabel).fill("   ");
      await submitDialog(dialog, dialogs.rename.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_name);
    });
  });

  test.describe("editing an operation with a mandatory reason", () => {
    async function seedOperation(page: Page): Promise<void> {
      await seed(async (seeder) => {
        const division = await seeder.division("Origen");
        await seeder.division("Destino");
        const site = await seeder.site("Sitio origen");
        await seeder.site("Sitio destino");
        await seeder.operation({ division, site, name: "Editable", costCenter: "4001" });
        await seeder.operation({ division, site, name: "Vecina", costCenter: "4002" });
      });
      await page.reload();
    }

    const editButton = (page: Page, name = "EDITABLE") =>
      buttonNamed(rowOf(page, name), dialogs.editOperation.trigger);

    test("opens prefilled with the current values and an empty reason", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await expect(dialog.getByRole("heading", { name: dialogs.editOperation.title("EDITABLE") })).toBeVisible();
      await expect(dialog.getByLabel(dialogs.editOperation.nameLabel)).toHaveValue("EDITABLE");
      await expect(dialog.getByLabel(dialogs.editOperation.divisionLabel, { exact: true })).toHaveValue(/.+/);
      await expect(dialog.getByLabel(dialogs.editOperation.costCenterLabel)).toHaveValue("4001");
      await expect(dialog.getByLabel(copy.common.reason)).toHaveValue("");
    });

    test("moves an operation to another division and site, changing name and cost center", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await fillOperation(dialog, {
        name: "movida", division: "DESTINO", site: "SITIO DESTINO", costCenter: "4900", reason: "Reorganización del área",
      });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog).toBeHidden();
      const row = rowOf(page, "MOVIDA");
      await expect(row).toContainText("4900");
      await expect(row).toContainText("SITIO DESTINO");
      await expect(divisionHeader(page, "DESTINO")).toContainText(t.operationCount(1));
      await expect(divisionHeader(page, "ORIGEN")).toContainText(t.operationCount(1));
    });

    test("refuses a reason made only of spaces", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await fillOperation(dialog, { costCenter: "4003", reason: "     " });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.reason_required);
      await expect(dialog.getByLabel(dialogs.editOperation.costCenterLabel)).toHaveValue("4003");
    });

    test("the browser blocks an empty reason before reaching the server", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await fillOperation(dialog, { costCenter: "4003" });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByLabel(copy.common.reason)).toHaveJSProperty("validity.valueMissing", true);
      await expect(dialog.getByRole("alert")).toHaveCount(0);
    });

    test("refuses a reason longer than 500 characters but accepts exactly 500", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await fillOperation(dialog, { costCenter: "4003", reason: "r".repeat(501) });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.reason_too_long);
      await fillOperation(dialog, { reason: "r".repeat(500) });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog).toBeHidden();
      await expect(rowOf(page, "EDITABLE")).toContainText("4003");
    });

    test("refuses an edit that changes nothing", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await fillOperation(dialog, { reason: "Sin cambios reales" });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.no_changes);
    });

    test("refuses a cost center that belongs to another operation", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await fillOperation(dialog, { costCenter: "4002", reason: "Probar duplicado" });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.cost_center_taken);
    });

    test("refuses a malformed cost center and a name used by a sibling", async ({ page }) => {
      await seedOperation(page);
      const dialog = await openDialog(page, editButton(page));
      await skipBrowserValidation(dialog);
      await fillOperation(dialog, { costCenter: "99", reason: "Formato" });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_cost_center);
      await fillOperation(dialog, { costCenter: "4001", name: "vecina" });
      await submitDialog(dialog, dialogs.editOperation.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.name_taken);
    });
  });

  test.describe("dialog behavior", () => {
    const trigger = (page: Page): Locator =>
      buttonNamed(mainArea(page), dialogs.newDivision.trigger);

    test("opens with its title and description", async ({ page }) => {
      const dialog = await openDialog(page, trigger(page));
      await expect(dialog.getByRole("heading", { name: dialogs.newDivision.title })).toBeVisible();
      await expect(dialog.getByText(dialogs.newDivision.description)).toBeVisible();
      await expect(dialog.getByText(dialogs.newDivision.nameHint)).toBeVisible();
    });

    test("closes with Escape and gives the focus back to its button", async ({ page }) => {
      const dialog = await openDialog(page, trigger(page));
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger(page)).toBeFocused();
    });

    test("closes with the cancel button, gives the focus back and writes nothing", async ({ page }) => {
      const dialog = await openDialog(page, trigger(page));
      await dialog.getByLabel(dialogs.newDivision.nameLabel).fill("No se crea");
      await buttonNamed(dialog, copy.common.cancel).click();
      await expect(dialog).toBeHidden();
      await expect(trigger(page)).toBeFocused();
      await expect(divisionHeader(page, "NO SE CREA")).toHaveCount(0);
    });

    test("keeps the typed values when the server rejects them", async ({ page }) => {
      await seed((seeder) => seeder.division("Existente"));
      await page.reload();
      const dialog = await openDialog(page, trigger(page));
      await dialog.getByLabel(dialogs.newDivision.nameLabel).fill("existente");
      await submitDialog(dialog, dialogs.newDivision.submit);
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel(dialogs.newDivision.nameLabel)).toHaveValue("existente");
    });

    test("does not show an old error when the dialog is opened again", async ({ page }) => {
      let dialog = await openDialog(page, trigger(page));
      await dialog.getByLabel(dialogs.newDivision.nameLabel).fill("   ");
      await submitDialog(dialog, dialogs.newDivision.submit);
      await expect(dialog.getByRole("alert")).toBeVisible();
      await page.keyboard.press("Escape");
      dialog = await openDialog(page, trigger(page));
      await expect(dialog.getByRole("alert")).toHaveCount(0);
    });

    test("on success it closes, clears its field and shows the new row", async ({ page }) => {
      let dialog = await openDialog(page, trigger(page));
      await dialog.getByLabel(dialogs.newDivision.nameLabel).fill("Recién creada");
      await submitDialog(dialog, dialogs.newDivision.submit);
      await expect(dialog).toBeHidden();
      await expect(divisionHeader(page, "RECIÉN CREADA")).toBeVisible();
      dialog = await openDialog(page, trigger(page));
      await expect(dialog.getByLabel(dialogs.newDivision.nameLabel)).toHaveValue("");
    });

    test("the operation dialog starts with both selects on their prompt", async ({ page }) => {
      const dialog = await openDialog(page, buttonNamed(mainArea(page), dialogs.newOperation.trigger));
      await expect(dialog.getByLabel(dialogs.newOperation.divisionLabel, { exact: true })).toHaveValue("");
      await expect(dialog.getByLabel(dialogs.newOperation.siteLabel, { exact: true })).toHaveValue("");
      await expect(dialog.getByText(dialogs.newOperation.siteHint)).toBeVisible();
    });
  });
});

test.describe("organization page as the fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("can create rows and edit operations, and also archive them", async ({ page }) => {
    await page.goto("/organization");
    const main = mainArea(page);
    for (const label of [dialogs.newDivision.trigger, dialogs.newSite.trigger, dialogs.newOperation.trigger]) {
      await expect(buttonNamed(main, label)).toBeVisible();
    }
    const operation = rowOf(page, WORLD_ORG.operation);
    await expect(buttonNamed(operation, dialogs.editOperation.trigger)).toBeVisible();
    await expect(buttonNamed(operation, dialogs.archive.trigger)).toBeVisible();
  });
});

test.describe("organization page as a viewer", () => {
  test.use({ storageState: storageStatePath("viewer") });
  test.beforeEach(resetCatalogs);

  test("reads every list but has no button to write or archive", async ({ page }) => {
    await seed((seeder) => seeder.division("Visible"));
    await page.goto("/organization");
    await expect(divisionHeader(page, "VISIBLE")).toBeVisible();
    await expect(divisionHeader(page, WORLD_ORG.division)).toBeVisible();
    await expect(rowOf(page, WORLD_ORG.operation)).toBeVisible();
    await expect(rowOf(page, WORLD_ORG.site)).toBeVisible();
    await expect(mainArea(page).getByRole("button")).toHaveCount(0);
    await expect(mainArea(page).getByRole("link", { name: t.showArchived })).toHaveCount(0);
  });

  test("cannot reach archived rows through the query string", async ({ page }) => {
    const id = await seed((seeder) => seeder.site("Escondido"));
    await archiveAsOwner("sites", id);
    await page.goto("/organization?archived=1");
    await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /ESCONDIDO/ })).toHaveCount(0);
  });
});

test.describe("organization page as a division manager", () => {
  test.use({ storageState: storageStatePath("manager") });
  test.beforeEach(resetCatalogs);

  test("sees the operations and sites of its division, and nothing from other divisions", async ({ page }) => {
    await seed(async (seeder) => {
      const own = readWorld().ids.division;
      const ownSite = await seeder.site("Sitio de mi division");
      await seeder.operation({ division: own, site: ownSite, name: "Operacion propia", costCenter: "5001" });
      const foreign = await seeder.division("Division ajena");
      const foreignSite = await seeder.site("Sitio ajeno");
      await seeder.operation({ division: foreign, site: foreignSite, name: "Operacion ajena", costCenter: "5002" });
    });
    await page.goto("/organization");
    await expect(divisionHeader(page, WORLD_ORG.division)).toContainText(t.operationCount(2));
    await expect(rowOf(page, "OPERACION PROPIA")).toBeVisible();
    await expect(rowOf(page, "SITIO DE MI DIVISION")).toBeVisible();
    await expect(divisionHeader(page, "DIVISION AJENA")).toHaveCount(0);
    await expect(page.getByRole("rowheader", { name: /AJENA/ })).toHaveCount(0);
  });

  test("has no button to create, edit, rename or archive", async ({ page }) => {
    await page.goto("/organization");
    await expect(rowOf(page, WORLD_ORG.operation)).toBeVisible();
    await expect(mainArea(page).getByRole("button")).toHaveCount(0);
  });
});

test.describe("organization page as an operation supervisor", () => {
  test.use({ storageState: storageStatePath("supervisor") });
  test.beforeEach(resetCatalogs);

  test("sees only its operation and its site, under an anonymous division group", async ({ page }) => {
    await seed(async (seeder) => {
      const site = await seeder.site("Sitio hermano");
      await seeder.operation({ division: readWorld().ids.division, site, name: "Operacion hermana", costCenter: "6001" });
    });
    await page.goto("/organization");
    await expect(rowOf(page, WORLD_ORG.operation)).toBeVisible();
    await expect(rowOf(page, WORLD_ORG.site)).toBeVisible();
    await expect(page.getByRole("rowheader", { name: /HERMAN/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 3, name: t.otherDivision })).toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: WORLD_ORG.division })).toHaveCount(0);
  });

  test("has no button to write", async ({ page }) => {
    await page.goto("/organization");
    await expect(rowOf(page, WORLD_ORG.operation)).toBeVisible();
    await expect(mainArea(page).getByRole("button")).toHaveCount(0);
  });
});

test.describe("organization page without a session", () => {
  test("redirects an anonymous visitor to the login page", async ({ page }) => {
    await page.goto("/organization");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: copy.login.title })).toBeVisible();
  });
});
