import { titleOf } from "../support/detail-page";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import { expectDialogClosed, fill, gotoFleet, openDialog, rowOf, skipBrowserValidation, submitDialog } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../support/mobile-flows";
import {
  DAYS,
  type ButtonKey,
  buttonsOf,
  catalogEntries,
  expectButtons,
  gotoDetail,
  historyTable,
  infoCard,
  isStoredArchived,
  locationCard,
  menuOf,
  pageAs,
  pillOf,
  detailPath,
  valueOf,
} from "../support/replace-flows";
import { readWorld, storageStatePath } from "../support/world";

const t = copy.fleet.detail;
const d = copy.dialogs;
const f = d.equipmentFields;
const byCode = copy.errors.byCode;
const REASON = "Agreed with the fleet manager";
const FAR_OPERATION = "VIS FAR OP";

type Seeded = { readonly idle: string; readonly assigned: string; readonly gone: string; readonly farOperation: string };

/**
 * ACT-IDLE never assigned; ACT-BUSY in OPERATION E2E since 2026-01-05; ACT-GONE archived. The far
 * operation belongs to another division, so neither scoped user covers it.
 */
async function seedActions(): Promise<Seeded> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplier = await seeder.supplier("Actions rental");
    const forklift = await seeder.assetType("Forklift");
    const farDivision = await seeder.division("Vis far division");
    const farSite = await seeder.site("Vis far site");
    const farOperation = await seeder.operation({ division: farDivision, site: farSite, name: FAR_OPERATION, costCenter: "7401" });
    const unit = (internalCode: string) => seeder.equipment({ supplierId: supplier, assetTypeId: forklift, internalCode, brand: "OLD BRAND" });
    const assigned = await unit("ACT-BUSY");
    await seeder.assign({ equipmentId: assigned, operationId: world.operation, day: DAYS.start, reason: "Loaded late" });
    const gone = await unit("ACT-GONE");
    await seeder.archiveEquipment(gone, "Loaded by mistake");
    return { idle: await unit("ACT-IDLE"), assigned, gone, farOperation };
  } finally {
    await seeder.close();
  }
}

/** Opens a dialog of the header and submits it with a reason; the dialog is returned so the caller reads the error. */
async function submitWithReason(page: Page, trigger: string, submit: string, reason: string): Promise<Locator> {
  const dialog = await openDialog(page, trigger, buttonsOf(page));
  await fill(dialog, copy.common.reason, reason);
  await submitDialog(dialog, submit);
  return dialog;
}

test.describe("editing from the detail page", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  async function submitEdit(page: Page, values: { brand?: string; model?: string; code?: string; reason: string }): Promise<Locator> {
    const dialog = await openDialog(page, d.editEquipment.trigger, buttonsOf(page));
    await skipBrowserValidation(dialog);
    if (values.code !== undefined) await fill(dialog, f.internalCodeLabel, values.code);
    if (values.brand !== undefined) await fill(dialog, f.brandLabel, values.brand);
    if (values.model !== undefined) await fill(dialog, f.modelLabel, values.model);
    await fill(dialog, copy.common.reason, values.reason);
    await submitDialog(dialog, d.editEquipment.submit);
    return dialog;
  }

  test("saves new values with a reason and the page shows them without a manual reload", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    await expect(valueOf(infoCard(page), t.info.brandModel)).toHaveText("OLD BRAND MODELO");
    await submitEdit(page, { brand: "New Brand", model: "Z-9", reason: REASON });
    await expectDialogClosed(page);
    await expect(valueOf(infoCard(page), t.info.brandModel)).toHaveText("New Brand Z-9");
    const entries = await catalogEntries("fleet.equipment.update", ids.idle);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: REASON, role: "fleet_analyst" });
  });

  test("changing the internal code retitles the page", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    await submitEdit(page, { code: "ACT-RENAMED", reason: REASON });
    await expectDialogClosed(page);
    await expect(page.getByRole("heading", { level: 1, name: titleOf("ACT-RENAMED") })).toBeVisible();
    await expect(valueOf(infoCard(page), t.info.internalCode)).toHaveText("ACT-RENAMED");
  });

  test("refuses a save with no changes", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    const dialog = await submitEdit(page, { reason: REASON });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.no_changes);
    expect(await catalogEntries("fleet.equipment.update", ids.idle)).toHaveLength(0);
  });

  test("asks for a reason and rejects a blank or a too long one", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    const dialog = await submitEdit(page, { brand: "Another", reason: "   " });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
    await fill(dialog, copy.common.reason, "r".repeat(501));
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_too_long);
    await expect(valueOf(infoCard(page), t.info.brandModel)).toHaveText("OLD BRAND MODELO");
    expect(await catalogEntries("fleet.equipment.update", ids.idle)).toHaveLength(0);
  });
});

test.describe("archiving and restoring from the detail page", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("an assigned equipment has no archive button until its assignment ends", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.assigned, "ACT-BUSY");
    await expectButtons(page, ["move", "replace", "end", "edit"]);
    const seeder = await openSeeder();
    await seeder.end({ equipmentId: ids.assigned, day: "2026-06-30", reason: "Parked" });
    await seeder.close();
    await gotoDetail(page, ids.assigned, "ACT-BUSY");
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    await expectButtons(page, ["assign", "edit", "archive"]);
  });

  test("archives with a reason: the header shows De baja, the buttons change and Editar disappears", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    await submitWithReason(page, d.archive.trigger, d.archive.submit, REASON);
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.common.archivedTag);
    await expectButtons(page, ["restore"]);
    await expect(locationCard(page).getByText(t.location.noneHintArchived)).toBeVisible();
    expect(await isStoredArchived(ids.idle)).toBe(true);
    const entries = await catalogEntries("fleet.archive", ids.idle);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: REASON, role: "fleet_analyst" });
  });

  test("the archive needs a reason", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    const dialog = await openDialog(page, d.archive.trigger, buttonsOf(page));
    await skipBrowserValidation(dialog);
    await fill(dialog, copy.common.reason, "   ");
    await submitDialog(dialog, d.archive.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    expect(await isStoredArchived(ids.idle)).toBe(false);
  });

  test("restores with a reason: back to Sin asignar with the full set of buttons", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.gone, "ACT-GONE");
    await expectButtons(page, ["restore"]);
    await submitWithReason(page, d.restore.trigger, d.restore.submit, REASON);
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    await expectButtons(page, ["assign", "edit", "archive"]);
    expect(await isStoredArchived(ids.gone)).toBe(false);
    const entries = await catalogEntries("fleet.restore", ids.gone);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ reason: REASON });
  });

  test("the restore needs a reason", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.gone, "ACT-GONE");
    const dialog = await openDialog(page, d.restore.trigger, buttonsOf(page));
    await skipBrowserValidation(dialog);
    await fill(dialog, copy.common.reason, "");
    await submitDialog(dialog, d.restore.submit);
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
    await expect(pillOf(page)).toHaveText(copy.common.archivedTag);
  });

  test("the board shows the same state after an archive and after a restore", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    await submitWithReason(page, d.archive.trigger, d.archive.submit, REASON);
    await expectDialogClosed(page);
    await gotoFleet(page);
    await expect(rowOf(page, "ACT-IDLE")).toHaveCount(0);
    await gotoFleet(page, "equipment", "archived=1");
    await expect(rowOf(page, "ACT-IDLE").getByText(copy.common.archivedTag, { exact: true })).toBeVisible();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    await submitWithReason(page, d.restore.trigger, d.restore.submit, REASON);
    await expectDialogClosed(page);
    await gotoFleet(page);
    await expect(rowOf(page, "ACT-IDLE").getByText(copy.fleet.state.unassigned, { exact: true })).toBeVisible();
  });
});

type Matrix = Readonly<Record<"assigned" | "idle" | "gone", readonly ButtonKey[]>>;

/** What each company-wide role sees on each state of an equipment. Scoped readers get their own test below. */
const WRITERS: Readonly<Record<"fleet_analyst" | "admin" | "viewer", Matrix>> = {
  fleet_analyst: { assigned: ["move", "replace", "end", "edit"], idle: ["assign", "edit", "archive"], gone: ["restore"] },
  admin: { assigned: ["move", "replace", "end", "edit"], idle: ["assign", "edit"], gone: [] },
  viewer: { assigned: [], idle: [], gone: [] },
};

for (const [role, matrix] of Object.entries(WRITERS) as [keyof typeof WRITERS, Matrix][]) {
  test.describe(`actions available to ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(resetCatalogs);

    test("show exactly the buttons the role may use on an assigned, an unassigned and an archived equipment", async ({ page }) => {
      const ids = await seedActions();
      await gotoDetail(page, ids.assigned, "ACT-BUSY");
      await expectButtons(page, matrix.assigned);
      await gotoDetail(page, ids.idle, "ACT-IDLE");
      await expectButtons(page, matrix.idle);
      await gotoDetail(page, ids.gone, "ACT-GONE");
      await expectButtons(page, matrix.gone);
    });

    test("show Corregir on the history rows only to a writer", async ({ page }) => {
      const ids = await seedActions();
      await gotoDetail(page, ids.assigned, "ACT-BUSY", "history");
      const corrections = historyTable(page).getByRole("button", { name: d.correctAssignment.trigger, exact: true });
      await expect(corrections).toHaveCount(role === "viewer" ? 0 : 1);
    });
  });
}

for (const role of ["manager", "supervisor"] as const) {
  test.describe(`a ${role} scoped to part of the company`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(resetCatalogs);

    test("reads the equipment of its scope on a page without any action, dialog or Corregir", async ({ page }) => {
      const ids = await seedActions();
      await gotoDetail(page, ids.assigned, "ACT-BUSY");
      await expect(menuOf(page)).toHaveCount(0);
      await expect(page.locator("#content").getByRole("button")).toHaveCount(0);
      await expect(page.locator("dialog")).toHaveCount(0);
      await expect(valueOf(locationCard(page), t.location.operation)).toHaveText("OPERATION E2E");
      await gotoDetail(page, ids.assigned, "ACT-BUSY", "history");
      await expect(page.locator("dialog")).toHaveCount(0);
      await expect(historyTable(page).getByRole("button")).toHaveCount(0);
    });
  });
}

test.describe("equipment visibility follows the assignment", () => {
  test.beforeEach(resetCatalogs);

  async function expectState(page: Page, id: string, code: string, visible: boolean): Promise<void> {
    const response = await page.goto(detailPath(id));
    if (visible) {
      expect(response?.status(), `${code} opens`).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: titleOf(code) })).toBeVisible();
    } else {
      expect(response?.status(), `${code} is not found`).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: copy.errors.notFound.title })).toBeVisible();
    }
    await gotoFleet(page);
    await expect(rowOf(page, code), `${code} on the board`).toHaveCount(visible ? 1 : 0);
  }

  test("moving the equipment to another division hides it from the scoped readers and keeps it for a company-wide viewer", async ({ browser }) => {
    const ids = await seedActions();
    const supervisor = await pageAs(browser, "supervisor");
    const manager = await pageAs(browser, "manager");
    const viewer = await pageAs(browser, "viewer");
    const analyst = await pageAs(browser, "fleet_analyst");
    try {
      for (const reader of [supervisor, manager, viewer]) await expectState(reader.page, ids.assigned, "ACT-BUSY", true);

      await gotoDetail(analyst.page, ids.assigned, "ACT-BUSY");
      const dialog = await openDialog(analyst.page, d.moveEquipment.trigger, buttonsOf(analyst.page));
      await dialog.getByLabel(d.moveEquipment.operationLabel, { exact: true }).selectOption({ label: FAR_OPERATION });
      await fill(dialog, d.moveEquipment.dayLabel, "2026-06-15");
      await fill(dialog, copy.common.reason, "The contract moved");
      await submitDialog(dialog, d.moveEquipment.submit);
      await expectDialogClosed(analyst.page);
      await expect(valueOf(locationCard(analyst.page), t.location.operation)).toHaveText(FAR_OPERATION);

      await expectState(supervisor.page, ids.assigned, "ACT-BUSY", false);
      await expectState(manager.page, ids.assigned, "ACT-BUSY", false);
      await expectState(viewer.page, ids.assigned, "ACT-BUSY", true);
    } finally {
      await Promise.all([supervisor, manager, viewer, analyst].map((entry) => entry.close()));
    }
  });

  test("ending the assignment hides the equipment from the scoped readers, and assigning it again brings it back", async ({ browser }) => {
    const ids = await seedActions();
    const supervisor = await pageAs(browser, "supervisor");
    const manager = await pageAs(browser, "manager");
    const viewer = await pageAs(browser, "viewer");
    try {
      for (const reader of [supervisor, manager, viewer]) await expectState(reader.page, ids.assigned, "ACT-BUSY", true);

      const seeder = await openSeeder();
      try {
        await seeder.end({ equipmentId: ids.assigned, day: "2026-06-30", reason: "Parked" });
        await expectState(supervisor.page, ids.assigned, "ACT-BUSY", false);
        await expectState(manager.page, ids.assigned, "ACT-BUSY", false);
        await expectState(viewer.page, ids.assigned, "ACT-BUSY", true);

        await seeder.assign({ equipmentId: ids.assigned, operationId: readWorld().ids.operation, day: "2026-07-01", reason: "Back to work" });
      } finally {
        await seeder.close();
      }
      for (const reader of [supervisor, manager, viewer]) await expectState(reader.page, ids.assigned, "ACT-BUSY", true);
    } finally {
      await Promise.all([supervisor, manager, viewer].map((entry) => entry.close()));
    }
  });
});

test.describe("equipment detail actions on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  async function expectDialogFits(dialog: Locator, submitLabel: string): Promise<void> {
    const box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(box.width, "the dialog takes the width of the phone").toBeGreaterThan(VIEWPORT_WIDTH - 60);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    const submit = dialog.getByRole("button", { name: submitLabel, exact: true });
    await submit.scrollIntoViewIfNeeded();
    const button = await boxOf(submit);
    expect(button.width, "the footer button is full width").toBeGreaterThan(VIEWPORT_WIDTH - 100);
    expect(button.y + button.height, "the footer button is reachable").toBeLessThanOrEqual(VIEWPORT_HEIGHT);
  }

  test("@mobile the Asignar dialog fits the viewport", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.idle, "ACT-IDLE");
    const dialog = await openDialog(page, d.assignEquipment.trigger, buttonsOf(page));
    await expectDialogFits(dialog, d.assignEquipment.submit);
  });

  test("@mobile the Mover dialog fits the viewport", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.assigned, "ACT-BUSY");
    const dialog = await openDialog(page, d.moveEquipment.trigger, buttonsOf(page));
    await expectDialogFits(dialog, d.moveEquipment.submit);
  });

  test("@mobile the Reemplazar dialog fits the viewport", async ({ page }) => {
    const ids = await seedActions();
    await gotoDetail(page, ids.assigned, "ACT-BUSY");
    const dialog = await openDialog(page, d.replaceEquipment.trigger, buttonsOf(page));
    await expectDialogFits(dialog, d.replaceEquipment.submit);
  });

  test("@mobile the detail page does not scroll sideways when assigned, unassigned or archived", async ({ page }) => {
    const ids = await seedActions();
    for (const [id, code] of [[ids.assigned, "ACT-BUSY"], [ids.idle, "ACT-IDLE"], [ids.gone, "ACT-GONE"]] as const) {
      await gotoDetail(page, id, code);
      await expectNoHorizontalScroll(page);
      await gotoDetail(page, id, code, "history");
      await expectNoHorizontalScroll(page);
    }
  });
});
