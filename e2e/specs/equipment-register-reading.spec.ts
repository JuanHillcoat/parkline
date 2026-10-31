import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { resetCatalogs } from "../support/data";
import { expectDialogClosed, fillEquipment, gotoFleet, openDialog, REQUIRED_TEXT_DEFAULTS, skipBrowserValidation, submitDialog } from "../support/fleet-flows";
import { maintenanceCard, rowValueOf } from "../support/detail-page";
import { chooseImage, png } from "../support/image-flows";
import { allActions, dayOffset, ddmmyyyy, gotoReadings, historyRows, hoursOf, messages, OTHER_OPERATION, panelOf, r, ringValue, seedReadingsBase, storedMeters, storedReadings, today, TYPES } from "../support/readings-flows";
import { storedAssignments } from "../support/assignment-flows";
import { actionsFor, equipmentIds, expectNothingRegistered, fillAssignment, registeredId } from "../support/register-assigned-flows";
import { boxOf, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../support/mobile-flows";
import { storageStatePath } from "../support/world";

const n = copy.dialogs.newEquipment;
const info = copy.fleet.detail.info;

const fresh = async (): Promise<void> => {
  await resetCatalogs();
  await seedReadingsBase();
};

/** The meter field is "Horómetro" for hours and "Kilometraje" for km; it has no group and no day of its own. */
const valueField = (dialog: Locator, kind: "hours" | "km" = "hours"): Locator => dialog.getByLabel(n.readingLabel[kind], { exact: true });
/** The reading takes the "Fecha de ingreso" of the registration, shared with the assignment. */
const dayField = (dialog: Locator): Locator => dialog.getByLabel(n.dayLabel, { exact: true });

/** Opens the registration dialog on the board and fills the equipment of the given asset type. */
async function openRegistration(page: Page, code: string, type: keyof typeof TYPES): Promise<Locator> {
  await gotoFleet(page, "equipment");
  const dialog = await openDialog(page, n.trigger);
  await skipBrowserValidation(dialog);
  await fillEquipment(dialog, { code, supplier: "RDG SUPPLIER", assetType: TYPES[type], ...REQUIRED_TEXT_DEFAULTS });
  return dialog;
}

for (const role of ["admin", "fleet_analyst"] as const) {
  test.describe(`registering an equipment with an initial reading as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("the reading alone opens the meter and shows in the Lecturas tab and the maintenance card", async ({ page }) => {
      const dialog = await openRegistration(page, `REGRD-A-${role.toUpperCase()}`, "hours");
      await valueField(dialog).fill("1234,5");
      await submitDialog(dialog, n.submit);
      await expectDialogClosed(page);
      const id = await registeredId(`REGRD-A-${role.toUpperCase()}`);
      expect(await storedMeters(id)).toEqual([{ kind: "hours", opened_on: today(), closed_on: null }]);
      expect((await storedReadings(id)).map((x) => [x.kind, x.value_tenths])).toEqual([["reading", 12_345]]);
      expect(await allActions(id)).toEqual(expect.arrayContaining(["fleet.equipment.create", "metering.reading.create"]));
      await gotoReadings(page, id, `REGRD-A-${role.toUpperCase()}`);
      await expect(historyRows(page)).toHaveCount(1);
      await expect(historyRows(page).first()).toContainText("1.234,5 h");
      await expect(historyRows(page).first()).toContainText(ddmmyyyy(today()));
      await page.goto(`/fleet/equipment/${id}`);
      await expect(ringValue(page)).toHaveText("0 hs");
      await expect(rowValueOf(maintenanceCard(page), copy.fleet.detail.maintenance.next)).toHaveText("1.484,5 hs");
    });

    test("the reading together with an assignment and an image is stored in one step", async ({ page }) => {
      const code = `REGRD-ALL-${role.toUpperCase()}`;
      const dialog = await openRegistration(page, code, "km");
      await chooseImage(dialog, png());
      await fillAssignment(dialog, { operation: OTHER_OPERATION, day: dayOffset(-1), reason: "Cargado ayer" });
      await valueField(dialog, "km").fill("500");
      await submitDialog(dialog, n.submit);
      await expectDialogClosed(page);
      const id = await registeredId(code);
      expect((await storedReadings(id)).map((x) => [x.read_on, x.value_tenths, x.meter_kind])).toEqual([[dayOffset(-1), 5000, "km"]]);
      expect((await actionsFor(id)).sort()).toEqual(["fleet.equipment.create"]);
      expect(await allActions(id)).toEqual(expect.arrayContaining(["fleet.equipment.create", "fleet.assignment.create", "metering.reading.create"]));
      expect(await storedAssignments(id)).toMatchObject([{ valid_from: dayOffset(-1), reason: "Cargado ayer" }]);
      await page.goto(`/fleet/equipment/${id}?tab=readings`);
      await expect(historyRows(page).first()).toContainText("500,0 km");
      await expect(hoursOf(page)).toHaveText("0,0 km");
      await page.goto(`/fleet/equipment/${id}`);
      await expect(page.getByRole("img", { name: info.photoLabel })).toBeVisible();
      await expect(ringValue(page)).toHaveText("0 km");
      await expect(rowValueOf(maintenanceCard(page), copy.fleet.detail.maintenance.next)).toHaveText("1.500 km");
    });

    test("without a typed value no meter is created", async ({ page }) => {
      const code = `REGRD-NONE-${role.toUpperCase()}`;
      const dialog = await openRegistration(page, code, "hours");
      await expect(dayField(dialog)).toHaveValue(today());
      await submitDialog(dialog, n.submit);
      await expectDialogClosed(page);
      const id = await registeredId(code);
      expect(await storedMeters(id)).toEqual([]);
      await gotoReadings(page, id, code);
      await expect(panelOf(page)).toContainText(r.empty);
    });

    test("the field follows the equipment type: hidden for none, Horómetro for hours, Kilometraje for km", async ({ page }) => {
      const dialog = await openRegistration(page, `REGRD-GROUP-${role.toUpperCase()}`, "none");
      const type = dialog.getByLabel(copy.dialogs.equipmentFields.assetTypeLabel, { exact: true });
      await expect(dialog.getByLabel(n.readingLabel.hours, { exact: true })).toHaveCount(0);
      await expect(dialog.getByLabel(n.readingLabel.km, { exact: true })).toHaveCount(0);
      await type.selectOption({ label: TYPES.hours });
      await expect(valueField(dialog, "hours")).toBeVisible();
      await expect(dialog.getByLabel(n.readingLabel.km, { exact: true })).toHaveCount(0);
      await expect(dayField(dialog)).toHaveValue(today());
      await type.selectOption({ label: TYPES.km });
      await expect(valueField(dialog, "km")).toBeVisible();
      await expect(dialog.getByLabel(n.readingLabel.hours, { exact: true })).toHaveCount(0);
      await type.selectOption({ label: TYPES.none });
      await expect(dialog.getByLabel(n.readingLabel.km, { exact: true })).toHaveCount(0);
    });

    test("a value typed before switching to a type without a meter is not sent", async ({ page }) => {
      const code = `REGRD-SWITCH-${role.toUpperCase()}`;
      const dialog = await openRegistration(page, code, "hours");
      await valueField(dialog).fill("99");
      await dialog.getByLabel(copy.dialogs.equipmentFields.assetTypeLabel, { exact: true }).selectOption({ label: TYPES.none });
      await submitDialog(dialog, n.submit);
      await expectDialogClosed(page);
      expect(await storedMeters(await registeredId(code))).toEqual([]);
    });

    test("a future day is refused with its message and nothing is created", async ({ page }) => {
      const code = `REGRD-FUTURE-${role.toUpperCase()}`;
      const dialog = await openRegistration(page, code, "hours");
      await fillAssignment(dialog, { operation: OTHER_OPERATION });
      await valueField(dialog).fill("10");
      await dayField(dialog).fill(dayOffset(3));
      await submitDialog(dialog, n.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.reading_in_future);
      await expectNothingRegistered(code);
    });

    test("an invalid value is refused with its message and nothing is created", async ({ page }) => {
      const code = `REGRD-INVALID-${role.toUpperCase()}`;
      const dialog = await openRegistration(page, code, "hours");
      for (const bad of ["10.55", "abc", "-5"]) {
        await valueField(dialog).fill(bad);
        await submitDialog(dialog, n.submit);
        await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_reading_value);
      }
      await expectNothingRegistered(code);
    });

    test("a repaired reading registers the equipment afterwards, exactly once", async ({ page }) => {
      const code = `REGRD-REPAIR-${role.toUpperCase()}`;
      const dialog = await openRegistration(page, code, "hours");
      await valueField(dialog).fill("10.55");
      await submitDialog(dialog, n.submit);
      await expect(dialog.getByRole("alert")).toHaveText(messages.invalid_reading_value);
      await valueField(dialog).fill("10.5");
      await submitDialog(dialog, n.submit);
      await expectDialogClosed(page);
      expect(await equipmentIds(code)).toHaveLength(1);
      expect(await storedReadings(await registeredId(code))).toHaveLength(1);
    });
  });
}

for (const role of ["viewer", "manager", "supervisor"] as const) {
  test.describe(`${role} cannot register equipment`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("has no Nuevo equipo button, so no initial reading either", async ({ page }) => {
      await page.goto("/fleet");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: n.trigger })).toHaveCount(0);
    });
  });
}

test.describe("the initial reading on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(fresh);

  test("@mobile the field fits the viewport and the dialog still reaches its submit button", async ({ page }) => {
    await gotoFleet(page, "equipment");
    await page.getByRole("button", { name: n.trigger, exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: n.title });
    await dialog.getByLabel(copy.dialogs.equipmentFields.assetTypeLabel, { exact: true }).selectOption({ label: TYPES.hours });
    await expect(valueField(dialog)).toBeVisible();
    const box = await boxOf(dialog);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    const submit = dialog.getByRole("button", { name: n.submit, exact: true });
    await submit.scrollIntoViewIfNeeded();
    const s = await boxOf(submit);
    expect(s.y + s.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    const field = await boxOf(valueField(dialog));
    expect(field.x + field.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
  });
});
