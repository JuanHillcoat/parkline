import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import { gotoFleet, openDialog, openDialogOf, rowOf } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, MIN_TAP_TARGET } from "../support/mobile-flows";
import { readWorld, storageStatePath, WORLD_ORG } from "../support/world";

const t = copy.fleet.detail;
const d = copy.dialogs;
const NO_VALUE = copy.fleet.noValue;
const OTHER_OPERATION = "DETAIL OTHER OP";
const OTHER_SITE = "DETAIL OTHER SITE";
const FAR_OPERATION = "DETAIL FAR OP";

type Ids = { active: string; idle: string; gone: string; elsewhere: string };

/**
 * The equipment of these suites:
 *   DET-ACTIVE    in OPERATION E2E since 2026-01-05, active, with brand, model and year
 *   DET-HIST      three assignments: spare in OPERATION E2E (open), then OTHER OP (closed), then OPERATION E2E (closed)
 *   DET-IDLE      never assigned
 *   DET-GONE      archived
 *   DET-ELSEWHERE in another division (neither scoped user sees it)
 */
async function seedDetail(): Promise<Ids & { hist: string }> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplier = await seeder.supplier("Norte rental");
    const forklift = await seeder.assetType("Forklift");
    const otherSite = await seeder.site(OTHER_SITE);
    const otherOperation = await seeder.operation({ division: world.division, site: otherSite, name: OTHER_OPERATION, costCenter: "7201" });
    const farDivision = await seeder.division("Detail far division");
    const farSite = await seeder.site("Detail far site");
    const farOperation = await seeder.operation({ division: farDivision, site: farSite, name: FAR_OPERATION, costCenter: "7202" });
    const unit = (internalCode: string, extra: { brand?: string; model?: string; year?: number } = {}) =>
      seeder.equipment({ supplierId: supplier, assetTypeId: forklift, internalCode, ...extra });
    const active = await unit("DET-ACTIVE", { brand: "BRAND X", model: "M-1", year: 2020 });
    await seeder.assign({ equipmentId: active, operationId: world.operation, day: "2026-01-05", reason: "Loaded late" });
    const hist = await unit("DET-HIST");
    await seeder.assign({ equipmentId: hist, operationId: world.operation, day: "2026-01-05", reason: "Backfill" });
    await seeder.move({ equipmentId: hist, operationId: otherOperation, day: "2026-02-10", reason: "Contract started" });
    await seeder.end({ equipmentId: hist, day: "2026-03-01", reason: "Parked" });
    await seeder.assign({ equipmentId: hist, operationId: world.operation, kind: "spare", day: "2026-04-01", reason: "Back as spare" });
    const idle = await unit("DET-IDLE");
    const gone = await unit("DET-GONE");
    await seeder.archiveEquipment(gone, "Loaded by mistake");
    const elsewhere = await unit("DET-ELSEWHERE");
    await seeder.assign({ equipmentId: elsewhere, operationId: farOperation, day: "2026-01-05", reason: "Far away" });
    return { active, idle, gone, elsewhere, hist };
  } finally {
    await seeder.close();
  }
}

const detailPath = (id: string, tab = ""): string => `/fleet/equipment/${id}${tab === "" ? "" : `?tab=${tab}`}`;

async function gotoDetail(page: Page, id: string, code: string, tab = ""): Promise<void> {
  await page.goto(detailPath(id, tab));
  await expect(page.getByRole("heading", { level: 1, name: t.title(code) })).toBeVisible();
}

const buttonsOf = (page: Page): Locator => page.getByRole("group", { name: t.actionsLabel });
const buttonNamed = (page: Page, name: string): Locator => buttonsOf(page).getByRole("button", { name, exact: true });
const pillOf = (page: Page): Locator => page.locator(".title-row .badge");
const historyTable = (page: Page): Locator => page.getByRole("table", { name: t.history.caption });
const historyRows = (page: Page): Locator => historyTable(page).locator("tbody tr");

/** The value shown beside a label of a card (definition list). */
const valueOf = (card: Locator, label: string): Locator =>
  card.locator("div.detail-row").filter({ has: card.page().getByText(label, { exact: true }) }).locator("dd");

const infoCard = (page: Page): Locator => page.getByRole("region", { name: t.info.title });
const locationCard = (page: Page): Locator => page.getByRole("region", { name: t.location.title });

const BUTTONS = {
  assign: d.assignEquipment.trigger,
  move: d.moveEquipment.trigger,
  replace: d.replaceEquipment.trigger,
  end: d.endAssignment.trigger,
  edit: d.editEquipment.trigger,
  archive: d.archive.trigger,
  restore: d.restore.trigger,
} as const;

type Shown = readonly (keyof typeof BUTTONS)[];

async function expectButtons(page: Page, shown: Shown): Promise<void> {
  for (const [key, name] of Object.entries(BUTTONS)) {
    const wanted = shown.includes(key as keyof typeof BUTTONS);
    await expect(buttonNamed(page, name), `${name} ${wanted ? "shows" : "is hidden"}`).toHaveCount(wanted ? 1 : 0);
  }
}

test.describe("equipment detail as a fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("the board links each internal code to its detail page, titled with the code and the type", async ({ page }) => {
    const ids = await seedDetail();
    await gotoFleet(page);
    await rowOf(page, "DET-ACTIVE").getByRole("link", { name: "DET-ACTIVE", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${detailPath(ids.active)}$`, "u"));
    await expect(page.getByRole("heading", { level: 1, name: t.title("DET-ACTIVE") })).toBeVisible();
    await expect(page.locator(".page-sub")).toHaveText("FORKLIFT");
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await expect(page.locator(".topbar-title")).toHaveText(copy.nav.fleet);
  });

  test("goes back to the board with Volver al listado", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    await page.getByRole("link", { name: t.back }).click();
    await expect(page).toHaveURL(/\/fleet$/u);
    await expect(page.getByRole("heading", { level: 1, name: copy.fleet.title })).toBeVisible();
  });

  test("the general information card shows every field, with dashes for the blanks and a photo placeholder", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const card = infoCard(page);
    const expected: readonly (readonly [string, string])[] = [
      [t.info.internalCode, "DET-ACTIVE"],
      [t.info.assetType, "FORKLIFT"],
      [t.info.supplier, "NORTE RENTAL"],
      [t.info.brand, "BRAND X"],
      [t.info.model, "M-1"],
      [t.info.year, "2020"],
      [t.info.serialNumber, NO_VALUE],
      [t.info.batteryKind, copy.fleet.batteryKind.combustion],
      [t.info.observations, NO_VALUE],
    ];
    for (const [label, value] of expected) await expect(valueOf(card, label), label).toHaveText(value);
    await expect(card.getByText(t.info.batteries, { exact: true }), "no quantity for a combustion equipment").toHaveCount(0);
    await expect(card.getByRole("img", { name: t.info.photoLabel })).toBeVisible();
    await expect(page.getByRole("region", { name: t.moreTitle })).toBeVisible();
  });

  test("the current location card names the operation, site, division, kind and the start day", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const card = locationCard(page);
    await expect(valueOf(card, t.location.operation)).toHaveText(WORLD_ORG.operation);
    await expect(valueOf(card, t.location.site)).toHaveText(WORLD_ORG.site);
    await expect(valueOf(card, t.location.division)).toHaveText(WORLD_ORG.division);
    await expect(valueOf(card, t.location.kind)).toHaveText(t.kinds.active);
    await expect(valueOf(card, t.location.since)).toHaveText("05/01/2026");
    await gotoDetail(page, ids.hist, "DET-HIST");
    await expect(valueOf(locationCard(page), t.location.kind)).toHaveText(t.kinds.spare);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
  });

  test("an unassigned equipment says Sin asignar with a hint and no location rows", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.idle, "DET-IDLE");
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    const card = locationCard(page);
    await expect(card.getByText(t.location.none, { exact: true })).toBeVisible();
    await expect(card.getByText(t.location.noneHint)).toBeVisible();
    await expect(card.locator("dt")).toHaveCount(0);
  });

  test("an archived equipment shows De baja and cannot be assigned", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.gone, "DET-GONE");
    await expect(pillOf(page)).toHaveText(copy.common.archivedTag);
    await expect(locationCard(page).getByText(t.location.noneHintArchived)).toBeVisible();
  });

  test("the Historial tab lists every assignment newest first, with Vigente for the open one", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.hist, "DET-HIST");
    await page.getByRole("link", { name: t.tabs.history }).click();
    await expect(page).toHaveURL(/tab=history/u);
    await expect(historyRows(page)).toHaveCount(3);
    const [open, middle, first] = [historyRows(page).nth(0), historyRows(page).nth(1), historyRows(page).nth(2)];
    await expect(open).toContainText("01/04/2026");
    await expect(open).toContainText(t.history.open);
    await expect(open.locator(`td[data-label="${t.history.operation}"]`)).toHaveText(NO_VALUE);
    await expect(open).toContainText(WORLD_ORG.site);
    await expect(open).toContainText(t.kinds.spare);
    await expect(open).toContainText("Back as spare");
    await expect(middle).toContainText("10/02/2026");
    await expect(middle).toContainText("01/03/2026");
    await expect(middle).toContainText(OTHER_OPERATION);
    await expect(middle).toContainText(OTHER_SITE);
    await expect(middle).toContainText(t.kinds.active);
    await expect(middle).toContainText("Parked");
    await expect(first).toContainText("05/01/2026");
    await expect(first).toContainText("09/02/2026");
    await expect(first).toContainText("Contract started");
    await expect(historyRows(page).locator(`td[data-label="${t.history.to}"] .badge`).filter({ hasText: t.history.open })).toHaveCount(1);
    await expect(page.getByRole("link", { name: t.tabs.history })).toHaveAttribute("aria-current", "page");
  });

  test("an equipment without assignments shows an empty history", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.idle, "DET-IDLE", "history");
    await expect(page.getByText(t.history.empty)).toBeVisible();
    await expect(historyTable(page)).toHaveCount(0);
  });

  test("an unknown tab falls back to the information tab", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE", "bogus");
    await expect(infoCard(page)).toBeVisible();
    await expect(page.getByRole("link", { name: t.tabs.info })).toHaveAttribute("aria-current", "page");
  });

  test("an unassigned equipment offers Asignar, Editar and Dar de baja", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.idle, "DET-IDLE");
    await expectButtons(page, ["assign", "edit", "archive"]);
  });

  test("an assigned equipment offers Mover, Reemplazar, Cerrar asignación and Editar, and no archive", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    await expectButtons(page, ["move", "replace", "end", "edit"]);
  });

  test("an archived equipment offers only Reactivar", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.gone, "DET-GONE");
    await expectButtons(page, ["restore"]);
  });

  test("every history row has a Corregir button for a writer", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.hist, "DET-HIST", "history");
    await expect(historyTable(page).getByRole("button", { name: d.correctAssignment.trigger, exact: true })).toHaveCount(3);
  });

  test("the assign dialog opens with the operations plus Muleto, today and an optional reason, and closes with Escape", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.idle, "DET-IDLE");
    const dialog = await openDialog(page, d.assignEquipment.trigger, buttonsOf(page));
    await expect(dialog.getByRole("heading", { name: d.assignEquipment.title("DET-IDLE") })).toBeVisible();
    await expect(dialog.getByLabel(d.assignEquipment.operationLabel, { exact: true })).toBeVisible();
    const operations = dialog.getByLabel(d.assignEquipment.operationLabel, { exact: true }).locator("option");
    await expect(operations).toHaveCount(5);
    await expect(operations.first()).toHaveText(d.assignEquipment.selectOperation);
    await expect(operations.last()).toHaveText(d.placement.muleto);
    await expect(operations.filter({ hasText: OTHER_OPERATION })).toHaveCount(1);
    await expect(operations.filter({ hasText: FAR_OPERATION })).toHaveCount(1);
    await expect(operations.filter({ hasText: WORLD_ORG.operation })).toHaveCount(1);
    await expect(dialog.getByLabel(d.placement.siteLabel, { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel(d.assignEquipment.dayLabel, { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u);
    await expect(dialog.getByLabel(d.assignEquipment.reasonLabel, { exact: true })).not.toHaveAttribute("required", /.*/u);
    await page.keyboard.press("Escape");
    await expect(openDialogOf(page)).toBeHidden();
  });

  test("the move dialog excludes the current operation and closes with Cancelar", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const dialog = await openDialog(page, d.moveEquipment.trigger, buttonsOf(page));
    await expect(dialog.getByRole("heading", { name: d.moveEquipment.title("DET-ACTIVE") })).toBeVisible();
    const operations = dialog.getByLabel(d.moveEquipment.operationLabel, { exact: true }).locator("option");
    await expect(operations).toHaveCount(4);
    await expect(operations.first()).toHaveText(d.moveEquipment.selectOperation);
    await expect(operations.last()).toHaveText(d.placement.muleto);
    await expect(operations.filter({ hasText: OTHER_OPERATION })).toHaveCount(1);
    await expect(operations.filter({ hasText: FAR_OPERATION })).toHaveCount(1);
    await expect(operations.filter({ hasText: WORLD_ORG.operation })).toHaveCount(0);
    await expect(dialog.getByLabel(d.moveEquipment.dayLabel, { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u);
    await expect(dialog.getByLabel(copy.common.reason, { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: copy.common.cancel }).click();
    await expect(openDialogOf(page)).toBeHidden();
  });

  test("the replace dialog preselects Dejarlo como muleto, offers the baja to an analyst and lists only free equipment", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const dialog = await openDialog(page, d.replaceEquipment.trigger, buttonsOf(page));
    await expect(dialog.getByRole("heading", { name: d.replaceEquipment.title("DET-ACTIVE") })).toBeVisible();
    const group = dialog.getByRole("group", { name: d.replaceEquipment.outgoingLegend });
    await expect(group.getByRole("radio", { name: d.replaceEquipment.outgoingSpare })).toBeChecked();
    await expect(group.getByRole("radio", { name: d.replaceEquipment.outgoingRetire })).not.toBeChecked();
    const incoming = dialog.getByLabel(d.replaceEquipment.incomingLabel, { exact: true }).locator("option");
    await expect(incoming).toHaveText([d.replaceEquipment.selectIncoming, "DET-IDLE - FORKLIFT"]);
    await page.keyboard.press("Escape");
    await expect(openDialogOf(page)).toBeHidden();
  });

  test("the end dialog asks for the last day and a reason, and the correct dialog is prefilled", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const end = await openDialog(page, d.endAssignment.trigger, buttonsOf(page));
    await expect(end.getByRole("heading", { name: d.endAssignment.title("DET-ACTIVE") })).toBeVisible();
    await expect(end.getByLabel(d.endAssignment.dayLabel, { exact: true })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/u);
    await expect(end.getByLabel(copy.common.reason, { exact: true })).toBeVisible();
    await end.getByRole("button", { name: copy.common.cancel }).click();
    await expect(openDialogOf(page)).toBeHidden();
    await gotoDetail(page, ids.hist, "DET-HIST", "history");
    const correct = await openDialog(page, d.correctAssignment.trigger, historyRows(page).nth(1));
    await expect(correct.getByRole("heading", { name: d.correctAssignment.title })).toBeVisible();
    await expect(correct.getByLabel(d.correctAssignment.fromLabel, { exact: true })).toHaveValue("2026-02-10");
    await expect(correct.getByLabel(d.correctAssignment.toLabel, { exact: true })).toHaveValue("2026-03-01");
    await expect(correct.getByLabel(d.correctAssignment.operationLabel, { exact: true }).locator("option:checked")).toHaveText(OTHER_OPERATION);
    await expect(correct.getByLabel(d.placement.siteLabel, { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(openDialogOf(page)).toBeHidden();
  });

  test("the open row of the history is prefilled with an empty end, Muleto and its site", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.hist, "DET-HIST", "history");
    const correct = await openDialog(page, d.correctAssignment.trigger, historyRows(page).nth(0));
    await expect(correct.getByLabel(d.correctAssignment.toLabel, { exact: true })).toHaveValue("");
    await expect(correct.getByLabel(d.correctAssignment.operationLabel, { exact: true }).locator("option:checked")).toHaveText(d.placement.muleto);
    await expect(correct.getByLabel(d.placement.siteLabel, { exact: true }).locator("option:checked")).toHaveText(WORLD_ORG.site);
  });

  test("the edit dialog of the board opens from the detail page", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const dialog = await openDialog(page, d.editEquipment.trigger, buttonsOf(page));
    await expect(dialog.getByRole("heading", { name: d.editEquipment.title("DET-ACTIVE") })).toBeVisible();
    await expect(dialog.getByLabel(d.equipmentFields.internalCodeLabel, { exact: true })).toHaveValue("DET-ACTIVE");
  });
});

test.describe("equipment detail as an administrator", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("can assign and edit but never archive, and the replace dialog hides the baja", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.idle, "DET-IDLE");
    await expectButtons(page, ["assign", "edit"]);
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    await expectButtons(page, ["move", "replace", "end", "edit"]);
    const dialog = await openDialog(page, d.replaceEquipment.trigger, buttonsOf(page));
    const group = dialog.getByRole("group", { name: d.replaceEquipment.outgoingLegend });
    await expect(group.getByRole("radio")).toHaveCount(1);
    await expect(group.getByRole("radio", { name: d.replaceEquipment.outgoingSpare })).toBeChecked();
    await expect(group.getByRole("radio", { name: d.replaceEquipment.outgoingRetire })).toHaveCount(0);
  });

  test("an archived equipment offers no button to an administrator", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.gone, "DET-GONE");
    await expectButtons(page, []);
    await expect(buttonsOf(page)).toHaveCount(0);
  });
});

for (const role of ["viewer", "manager", "supervisor"] as const) {
  test.describe(`equipment detail as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(resetCatalogs);

    test("reads the equipment of its scope without any action button or Corregir", async ({ page }) => {
      const ids = await seedDetail();
      await gotoDetail(page, ids.active, "DET-ACTIVE");
      await expect(buttonsOf(page)).toHaveCount(0);
      await expect(page.locator("#content").getByRole("button")).toHaveCount(0);
      await expect(valueOf(locationCard(page), t.location.operation)).toHaveText(WORLD_ORG.operation);
      await gotoDetail(page, ids.active, "DET-ACTIVE", "history");
      await expect(historyRows(page)).toHaveCount(1);
      await expect(historyTable(page).getByRole("button", { name: d.correctAssignment.trigger })).toHaveCount(0);
    });
  });
}

for (const role of ["manager", "supervisor"] as const) {
  test.describe(`equipment detail outside the scope of ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(resetCatalogs);

    test("answers the same not-found page for an equipment out of scope, an unassigned one and a missing id", async ({ page }) => {
      const ids = await seedDetail();
      const bodies: string[] = [];
      for (const id of [ids.elsewhere, ids.idle, ids.gone, "00000000-0000-4000-8000-000000000000", "not-an-id"]) {
        const response = await page.goto(detailPath(id));
        expect(response?.status(), id).toBe(404);
        await expect(page.getByRole("heading", { level: 1, name: copy.errors.notFound.title })).toBeVisible();
        bodies.push(await page.locator("main.centered").innerText());
      }
      expect(new Set(bodies).size).toBe(1);
    });
  });
}

test.describe("equipment detail as a viewer: an unknown id", () => {
  test.use({ storageState: storageStatePath("viewer") });
  test.beforeEach(resetCatalogs);

  test("a company-wide reader gets the not-found page for a missing id", async ({ page }) => {
    await seedDetail();
    const response = await page.goto(detailPath("00000000-0000-4000-8000-000000000000"));
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: copy.errors.notFound.title })).toBeVisible();
  });
});

test.describe("equipment detail on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("@mobile the cards stack, nothing scrolls sideways and every button is at least 40px tall", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    await expectNoHorizontalScroll(page);
    const info = await boxOf(infoCard(page));
    const location = await boxOf(locationCard(page));
    expect(location.y, "the location card sits below the information card").toBeGreaterThan(info.y + info.height - 1);
    expect(Math.abs(location.x - info.x), "cards share the same left edge").toBeLessThanOrEqual(1);
    for (const button of await buttonsOf(page).getByRole("button").all()) {
      expect((await boxOf(button)).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    expect((await boxOf(page.getByRole("link", { name: t.back }))).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    for (const tab of [t.tabs.info, t.tabs.history]) {
      expect((await boxOf(page.getByRole("link", { name: tab }))).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
  });

  test("@mobile the history becomes cards without horizontal scroll and Corregir is a 40px target", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.hist, "DET-HIST", "history");
    await expectNoHorizontalScroll(page);
    const [first, second] = [await boxOf(historyRows(page).nth(0)), await boxOf(historyRows(page).nth(1))];
    expect(second.y, "rows are stacked cards").toBeGreaterThan(first.y);
    for (const button of await historyTable(page).getByRole("button", { name: d.correctAssignment.trigger }).all()) {
      expect((await boxOf(button)).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    await expect(historyRows(page).nth(0).locator('td[data-label="' + t.history.to + '"]')).toContainText(t.history.open);
  });

  test("@mobile the dialogs fit the screen", async ({ page }) => {
    const ids = await seedDetail();
    await gotoDetail(page, ids.active, "DET-ACTIVE");
    const dialog = await openDialog(page, d.replaceEquipment.trigger, buttonsOf(page));
    expect((await boxOf(dialog)).width).toBeLessThanOrEqual(400);
    await expectNoHorizontalScroll(page);
  });
});
