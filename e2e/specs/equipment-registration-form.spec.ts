/**
 * The compact registration form (issue 54, S1 to S6): field order, the battery rules, Horómetro, Operación or
 * Muleto and its Site, "Fecha de ingreso" shared by the assignment and the reading, Observaciones as the reason, the
 * one-screen layout, roles, the edit dialog and the target select of the detail dialogs.
 */
import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import {
  buttonsOf, gotoDetail, historyRows, locationCard, pillOf, storedAssignments, submitAssign, submitCorrection, submitMove, today, valueOf,
} from "../support/assignment-flows";
import { resetCatalogs } from "../support/data";
import { chooseImage, png, previewOf } from "../support/image-flows";
import { expectDialogClosed, openDialog, rowOf, submitDialog } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../support/mobile-flows";
import { dayOffset, storedReadings } from "../support/readings-flows";
import { registeredId } from "../support/register-assigned-flows";
import {
  DEFAULT_LABELS, expectRefused, f, fillRegistration, footprint, FULL_LABELS, FX, messages, meterField, n, openRegistration, p, register, registerOk,
  seedFormFixture, seedUnit, showEverything, storedEquipment, visibleLabels, type FormFixture,
} from "../support/registration-form-flows";
import { fillReplace, submitReplace } from "../support/replace-flows";
import { readWorld, storageStatePath, WORLD_ORG } from "../support/world";

const detail = copy.fleet.detail;
const state = copy.fleet.state;
const NO_VALUE = copy.fleet.noValue;

let fx: FormFixture;
const fresh = async (): Promise<void> => {
  await resetCatalogs();
  fx = await seedFormFixture();
};

test.describe("the registration form as a fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(fresh);

  test.describe("layout", () => {
    test("lists the fields in the order of the maintainer, without the old groups", async ({ page }) => {
      const dialog = await openRegistration(page);
      expect(await visibleLabels(dialog)).toEqual([...DEFAULT_LABELS]);
      await expect(dialog.getByRole("group")).toHaveCount(0);
      for (const gone of ["Asignación (opcional)", "Lectura inicial", "Tipo de asignación", "Día de la lectura", "Motivo"]) {
        await expect(dialog.getByText(gone, { exact: false }), gone).toHaveCount(0);
      }
    });

    test("shows the quantity, Horómetro and the Site in their place when every condition holds", async ({ page }) => {
      const dialog = await openRegistration(page);
      await showEverything(dialog);
      expect(await visibleLabels(dialog)).toEqual([...FULL_LABELS]);
    });

    test("Interno has no hint under it", async ({ page }) => {
      const dialog = await openRegistration(page);
      const interno = dialog.locator(".field").filter({ has: dialog.getByLabel(f.internalCodeLabel, { exact: true }) });
      await expect(interno.locator(".hint")).toHaveCount(0);
      await expect(dialog.getByText("Se guarda en mayúsculas")).toHaveCount(0);
    });

    test("uses the word Tipo de equipo and never Tipo de activo", async ({ page }) => {
      const dialog = await openRegistration(page);
      await expect(dialog.getByLabel("Tipo de equipo", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Tipo de activo", { exact: false })).toHaveCount(0);
      await expect(dialog.getByLabel(f.assetTypeLabel, { exact: true }).getByRole("option").first()).toHaveText("Seleccione un tipo de equipo");
    });

    test("fits one screen at 1280 x 800 without scrolling, even with every conditional field shown", async ({ page }) => {
      const dialog = await openRegistration(page);
      await showEverything(dialog);
      await chooseImage(dialog, png());
      await expect(previewOf(dialog)).toBeVisible();
      await expect(dialog.getByLabel(p.siteLabel, { exact: true })).toBeVisible();
      const sizes = await dialog.evaluate((element) => ({ scroll: element.scrollHeight, client: element.clientHeight }));
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
      const submit = await boxOf(dialog.getByRole("button", { name: n.submit, exact: true }));
      expect(submit.y + submit.height).toBeLessThanOrEqual(800);
      const box = await boxOf(dialog);
      expect(box.width, "a wide dialog with several columns").toBeGreaterThan(800);
    });

    test("the image preview is a small thumbnail and no field of the grid stretches because of it", async ({ page }) => {
      const dialog = await openRegistration(page);
      await showEverything(dialog);
      const day = dialog.getByLabel(n.dayLabel, { exact: true });
      const place = dialog.getByLabel(n.operationLabel, { exact: true });
      const before = await boxOf(day);
      await chooseImage(dialog, png());
      await expect(previewOf(dialog)).toBeVisible();
      const thumb = await boxOf(previewOf(dialog));
      expect(thumb.width).toBeLessThanOrEqual(48);
      expect(thumb.height).toBeLessThanOrEqual(48);
      for (const field of [place, day, dialog.getByLabel(f.batteryQuantityLabel, { exact: true }), dialog.getByLabel(f.supplierLabel, { exact: true })]) {
        expect((await boxOf(field)).height, "a field of the grid keeps its own height").toBeLessThanOrEqual(60);
      }
      const image = await boxOf(dialog.getByLabel(copy.dialogs.imageField.label, { exact: true }));
      const notes = await boxOf(dialog.getByLabel(f.observationsLabel, { exact: true }));
      const dayBox = await boxOf(day);
      expect(image.y, "Imagen sits on its own row below Fecha de ingreso").toBeGreaterThan(dayBox.y + dayBox.height);
      expect(notes.y, "Observaciones comes after Imagen").toBeGreaterThan(image.y + image.height);
      const after = await boxOf(day);
      expect(after.height).toBe(before.height);
      expect(after.width).toBe(before.width);
    });
  });

  test.describe("battery", () => {
    test("shows the quantity only for Plomo ácido, not for Litio, Combustión or nothing chosen", async ({ page }) => {
      const dialog = await openRegistration(page);
      const quantity = dialog.getByLabel(f.batteryQuantityLabel, { exact: true });
      const kind = dialog.getByLabel(f.batteryKindLabel, { exact: true });
      await expect(kind.getByRole("option")).toHaveText([f.selectBatteryKind, "Litio", "Plomo ácido", "Combustión"]);
      await expect(quantity).toHaveCount(0);
      await kind.selectOption({ label: "Litio" });
      await expect(quantity).toHaveCount(0);
      await kind.selectOption({ label: "Plomo ácido" });
      await expect(quantity).toBeVisible();
      await kind.selectOption({ label: "Combustión" });
      await expect(quantity).toHaveCount(0);
    });

    test("stores Plomo ácido with its quantity", async ({ page }) => {
      await registerOk(page, { code: "RF-LEAD", batteryKind: "lead_acid", batteries: "3" });
      expect(await storedEquipment("RF-LEAD")).toMatchObject({ battery_kind: "lead_acid", battery_quantity: 3 });
    });

    for (const [kind, label] of [["lithium", "Litio"], ["combustion", "Combustión"]] as const) {
      test(`${label} stores no quantity`, async ({ page }) => {
        const code = `RF-${kind.toUpperCase()}`;
        await registerOk(page, { code, batteryKind: kind });
        expect(await storedEquipment(code)).toMatchObject({ battery_kind: kind, battery_quantity: null });
      });

      test(`a quantity typed for Plomo ácido and then dropped by choosing ${label} is not sent`, async ({ page }) => {
        const code = `RF-STALE-${kind.toUpperCase()}`;
        const dialog = await openRegistration(page);
        await dialog.getByLabel(f.batteryKindLabel, { exact: true }).selectOption({ label: "Plomo ácido" });
        await dialog.getByLabel(f.batteryQuantityLabel, { exact: true }).fill("4");
        await dialog.getByLabel(f.batteryKindLabel, { exact: true }).selectOption({ label });
        await expect(dialog.getByLabel(f.batteryQuantityLabel, { exact: true })).toHaveCount(0);
        await fillRegistration(dialog, { code, assetType: FX.types.none });
        await dialog.getByLabel(f.batteryKindLabel, { exact: true }).selectOption({ label });
        await submitDialog(dialog, n.submit);
        await expectDialogClosed(page);
        expect(await storedEquipment(code)).toMatchObject({ battery_kind: kind, battery_quantity: null });
      });
    }

    test("a battery kind is required: without it the server answers with its typed message and creates nothing", async ({ page }) => {
      const dialog = await openRegistration(page, { skipChecks: true });
      await dialog.getByLabel(f.internalCodeLabel, { exact: true }).fill("RF-NOKIND");
      await dialog.getByLabel(f.supplierLabel, { exact: true }).selectOption({ label: FX.supplier });
      await dialog.getByLabel(f.assetTypeLabel, { exact: true }).selectOption({ label: FX.types.none });
      await dialog.getByLabel(f.brandLabel, { exact: true }).fill("MARCA");
      await dialog.getByLabel(f.modelLabel, { exact: true }).fill("MODELO");
      await submitDialog(dialog, n.submit);
      await expectRefused(dialog, "RF-NOKIND", messages.invalid_battery_kind);
    });
  });

  test.describe("Horómetro", () => {
    test("is hidden before a type is chosen and for a type without a meter, Horómetro for hours and Kilometraje for km", async ({ page }) => {
      const dialog = await openRegistration(page);
      const type = dialog.getByLabel(f.assetTypeLabel, { exact: true });
      await expect(meterField(dialog)).toHaveCount(0);
      await type.selectOption({ label: FX.types.hours });
      await expect(dialog.getByLabel("Horómetro", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("Kilometraje", { exact: true })).toHaveCount(0);
      await type.selectOption({ label: FX.types.km });
      await expect(dialog.getByLabel("Kilometraje", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("Horómetro", { exact: true })).toHaveCount(0);
      await type.selectOption({ label: FX.types.none });
      await expect(meterField(dialog)).toHaveCount(0);
    });

    test("opens the meter with the typed value on the registration day", async ({ page }) => {
      await registerOk(page, { code: "RF-HOURS", reading: "120,5" });
      const id = await registeredId("RF-HOURS");
      expect((await storedReadings(id)).map((row) => [row.read_on, row.value_tenths, row.meter_kind])).toEqual([[today(), 1205, "hours"]]);
    });

    test("a kilometer reading is stored with its meter", async ({ page }) => {
      await registerOk(page, { code: "RF-KM", assetType: FX.types.km, reading: "800" });
      expect((await storedReadings(await registeredId("RF-KM"))).map((row) => [row.value_tenths, row.meter_kind])).toEqual([[8000, "km"]]);
    });
  });

  test.describe("Operación, Muleto and Site", () => {
    test("lists no operation first, then every active operation, and Muleto last", async ({ page }) => {
      const dialog = await openRegistration(page);
      const options = dialog.getByLabel(n.operationLabel, { exact: true }).getByRole("option");
      await expect(options).toHaveCount(6);
      await expect(options.first()).toHaveText(n.noOperation);
      await expect(options.last()).toHaveText(p.muleto);
      for (const name of [WORLD_ORG.operation, FX.opOne, FX.opTwo, FX.opB]) await expect(options.filter({ hasText: name }), name).toHaveCount(1);
    });

    test("Muleto shows the Site select with every active site, and any other choice hides it", async ({ page }) => {
      const dialog = await openRegistration(page);
      const place = dialog.getByLabel(n.operationLabel, { exact: true });
      await expect(dialog.getByLabel(p.siteLabel, { exact: true })).toHaveCount(0);
      await place.selectOption({ label: p.muleto });
      const site = dialog.getByLabel(p.siteLabel, { exact: true });
      await expect(site.getByRole("option")).toHaveText([p.selectSite, FX.siteB, WORLD_ORG.site]);
      await place.selectOption({ label: FX.opOne });
      await expect(site).toHaveCount(0);
      await place.selectOption({ label: n.noOperation });
      await expect(site).toHaveCount(0);
    });

    test("an operation chosen after Muleto wins: the unit is active there and the site is not sent", async ({ page }) => {
      const dialog = await openRegistration(page);
      await dialog.getByLabel(n.operationLabel, { exact: true }).selectOption({ label: p.muleto });
      await dialog.getByLabel(p.siteLabel, { exact: true }).selectOption({ label: FX.siteB });
      await fillRegistration(dialog, { code: "RF-SWITCH", operation: FX.opOne });
      await expect(dialog.getByLabel(p.siteLabel, { exact: true })).toHaveCount(0);
      await submitDialog(dialog, n.submit);
      await expectDialogClosed(page);
      expect(await storedAssignments(await registeredId("RF-SWITCH"))).toMatchObject([{ kind: "active", operation_id: fx.opOne }]);
    });

    test("Muleto registers a spare of that site: the board and the detail show Muleto, the site and no operation", async ({ page }) => {
      await registerOk(page, { code: "RF-MULETO", site: FX.siteB });
      const id = await registeredId("RF-MULETO");
      expect(await storedAssignments(id)).toEqual([
        { valid_from: today(), valid_to: null, kind: "spare", operation_id: null, site_id: fx.siteB, reason: null },
      ]);
      const row = rowOf(page, "RF-MULETO");
      await expect(row.getByText(state.spare, { exact: true })).toBeVisible();
      await expect(row.locator(`td[data-label="${copy.fleet.columns.site}"]`)).toHaveText(FX.siteB);
      await expect(row.locator(`td[data-label="${copy.fleet.columns.operation}"]`)).toHaveText(NO_VALUE);
      await gotoDetail(page, id, "RF-MULETO");
      await expect(pillOf(page)).toHaveText(state.spare);
      await expect(valueOf(locationCard(page), detail.location.site)).toHaveText(FX.siteB);
      await expect(valueOf(locationCard(page), detail.location.kind)).toHaveText(detail.kinds.spare);
      await expect(locationCard(page).getByText(detail.location.operation, { exact: true })).toHaveCount(0);
      await expect(locationCard(page).getByText(detail.location.division, { exact: true })).toHaveCount(0);
    });

    test("Muleto without a Site is not submitted: the browser asks for the site and nothing is created", async ({ page }) => {
      const dialog = await openRegistration(page);
      // Every other required field is filled, so the Site is the only thing the browser can object to.
      await fillRegistration(dialog, { code: "RF-NOSITE", operation: p.muleto });
      await expect(dialog.getByLabel(p.siteLabel, { exact: true })).toBeVisible();
      expect(await dialog.getByLabel(p.siteLabel, { exact: true }).evaluate((field: HTMLSelectElement) => field.required)).toBe(true);
      expect(await dialog.locator("form").evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(false);
      await submitDialog(dialog, n.submit);
      await expect(dialog).toBeVisible();
      expect(await footprint("RF-NOSITE")).toEqual({ equipments: 0, assignments: 0, readings: 0 });
    });

    test("an operation registers an active unit there, together with its reading", async ({ page }) => {
      await registerOk(page, { code: "RF-OP", operation: FX.opOne, reading: "50" });
      const id = await registeredId("RF-OP");
      expect(await storedAssignments(id)).toMatchObject([{ kind: "active", operation_id: fx.opOne, site_id: readWorld().ids.site }]);
      expect((await storedReadings(id)).map((row) => row.value_tenths)).toEqual([500]);
      await expect(rowOf(page, "RF-OP")).toContainText(FX.opOne);
      await expect(rowOf(page, "RF-OP").getByText(state.active, { exact: true })).toBeVisible();
    });

    test("no operation registers the unit unassigned, and a typed reading is still stored", async ({ page }) => {
      await registerOk(page, { code: "RF-FREE", reading: "7" });
      const id = await registeredId("RF-FREE");
      expect(await storedAssignments(id)).toEqual([]);
      expect((await storedReadings(id)).map((row) => [row.read_on, row.value_tenths])).toEqual([[today(), 70]]);
      await expect(rowOf(page, "RF-FREE").getByText(state.unassigned, { exact: true })).toBeVisible();
    });
  });

  test.describe("Fecha de ingreso and Observaciones", () => {
    test("Fecha de ingreso is today by default and Observaciones is optional for today", async ({ page }) => {
      const dialog = await openRegistration(page);
      await expect(dialog.getByLabel(n.dayLabel, { exact: true })).toHaveValue(today());
      await expect(dialog.getByLabel(f.observationsLabel, { exact: true })).not.toHaveAttribute("required", /.*/u);
      await registerOk(page, { code: "RF-TODAY", operation: FX.opOne });
      expect(await storedAssignments(await registeredId("RF-TODAY"))).toMatchObject([{ valid_from: today(), reason: null }]);
    });

    test("one day is shared by the assignment and the reading", async ({ page }) => {
      const day = dayOffset(-2);
      await registerOk(page, { code: "RF-DAY", operation: FX.opOne, reading: "300", day, observations: "Backfilled" });
      const id = await registeredId("RF-DAY");
      expect((await storedAssignments(id)).map((row) => row.valid_from)).toEqual([day]);
      expect((await storedReadings(id)).map((row) => row.read_on)).toEqual([day]);
    });

    test("a past day without Observaciones shows the message that names Observaciones and creates nothing", async ({ page }) => {
      const dialog = await register(page, { code: "RF-NOOBS", operation: FX.opOne, reading: "10", day: "2025-03-01" });
      await expectRefused(dialog, "RF-NOOBS", messages.registration_day_in_past);
      await expect(dialog.getByRole("alert")).toContainText(f.observationsLabel);
      await expect(dialog.getByRole("alert")).not.toContainText(copy.common.reason);
    });

    test("a past day with Observaciones stores it as the assignment reason and as the observations of the equipment", async ({ page }) => {
      await registerOk(page, { code: "RF-OBS", operation: FX.opOne, day: "2025-03-01", observations: "Loaded late" });
      const id = await registeredId("RF-OBS");
      expect(await storedAssignments(id)).toMatchObject([{ valid_from: "2025-03-01", reason: "Loaded late" }]);
      expect(await storedEquipment("RF-OBS")).toMatchObject({ observations: "Loaded late" });
    });

    test("a past day without an operation needs no Observaciones: there is no assignment to explain", async ({ page }) => {
      await registerOk(page, { code: "RF-PASTFREE", day: "2025-03-01" });
      expect(await storedAssignments(await registeredId("RF-PASTFREE"))).toEqual([]);
    });
  });

  test.describe("edit dialog", () => {
    const openEdit = async (page: Page, code: string) => {
      await registerOk(page, { code, batteryKind: "lead_acid", batteries: "3", observations: "Left mast" });
      return openDialog(page, copy.dialogs.editEquipment.trigger, rowOf(page, code));
    };

    test("shows the battery kind and quantity, uses Tipo de equipo and keeps the order of the registration", async ({ page }) => {
      const dialog = await openEdit(page, "RF-EDIT");
      await expect(dialog.getByLabel(f.batteryKindLabel, { exact: true })).toHaveValue("lead_acid");
      await expect(dialog.getByLabel(f.batteryQuantityLabel, { exact: true })).toHaveValue("3");
      expect(await visibleLabels(dialog)).toEqual([
        f.internalCodeLabel, f.assetTypeLabel, f.brandLabel, f.modelLabel, f.serialNumberLabel, f.yearLabel,
        f.batteryKindLabel, f.batteryQuantityLabel, f.supplierLabel, copy.dialogs.imageField.add, f.observationsLabel, copy.common.reason,
      ]);
    });

    test("changing to Litio drops the quantity: the stored unit has the new kind and no quantity", async ({ page }) => {
      const dialog = await openEdit(page, "RF-EDIT2");
      await dialog.getByLabel(f.batteryKindLabel, { exact: true }).selectOption({ label: "Litio" });
      await expect(dialog.getByLabel(f.batteryQuantityLabel, { exact: true })).toHaveCount(0);
      await dialog.getByLabel(copy.common.reason, { exact: true }).fill("Battery replaced");
      await submitDialog(dialog, copy.dialogs.editEquipment.submit);
      await expectDialogClosed(page);
      expect(await storedEquipment("RF-EDIT2")).toMatchObject({ battery_kind: "lithium", battery_quantity: null });
    });
  });
});

for (const role of ["admin", "fleet_analyst"] as const) {
  test.describe(`registering with the compact form as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("registers an equipment in an operation with a reading", async ({ page }) => {
      const code = `RF-ROLE-${role.toUpperCase()}`;
      await registerOk(page, { code, operation: FX.opTwo, reading: "10" });
      expect(await storedAssignments(await registeredId(code))).toMatchObject([{ kind: "active", operation_id: fx.opTwo }]);
    });
  });
}

for (const role of ["viewer", "manager", "supervisor"] as const) {
  test.describe(`${role} and the registration form`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("has no Nuevo equipo button", async ({ page }) => {
      await page.goto("/fleet");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: n.trigger })).toHaveCount(0);
    });
  });
}

test.describe("the target select of the detail dialogs", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(fresh);

  test("assign: lists the operations and Muleto, and assigning as Muleto at a site stores a spare of it", async ({ page }) => {
    const id = await seedUnit(fx, "RF-D1");
    await gotoDetail(page, id, "RF-D1");
    const dialog = await openDialog(page, copy.dialogs.assignEquipment.trigger, buttonsOf(page));
    const options = dialog.getByLabel(copy.dialogs.assignEquipment.operationLabel, { exact: true }).getByRole("option");
    await expect(options.first()).toHaveText(copy.dialogs.assignEquipment.selectOperation);
    await expect(options.last()).toHaveText(p.muleto);
    await expect(dialog.getByLabel(p.siteLabel, { exact: true })).toHaveCount(0);
    await dialog.getByLabel(copy.dialogs.assignEquipment.operationLabel, { exact: true }).selectOption({ label: p.muleto });
    await expect(dialog.getByLabel(p.siteLabel, { exact: true }).getByRole("option")).toHaveText([p.selectSite, FX.siteB, WORLD_ORG.site]);
    await dialog.getByRole("button", { name: copy.common.cancel }).click();
    await submitAssign(page, { site: FX.siteB });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(state.spare);
    await expect(valueOf(locationCard(page), detail.location.site)).toHaveText(FX.siteB);
    expect(await storedAssignments(id)).toMatchObject([{ kind: "spare", operation_id: null, site_id: fx.siteB }]);
  });

  test("assign to an operation keeps the unit active there", async ({ page }) => {
    const id = await seedUnit(fx, "RF-D2");
    await gotoDetail(page, id, "RF-D2");
    await submitAssign(page, { operation: FX.opB });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(state.active);
    await expect(valueOf(locationCard(page), detail.location.site)).toHaveText(FX.siteB);
    expect(await storedAssignments(id)).toMatchObject([{ kind: "active", operation_id: fx.opB, site_id: fx.siteB }]);
  });

  test("move: between an operation, a site as a spare and an operation again, with the history of each", async ({ page }) => {
    const id = await seedUnit(fx, "RF-D3", fx.opOne);
    await gotoDetail(page, id, "RF-D3");
    await submitMove(page, { site: FX.siteB, day: dayOffset(1), reason: "Idle at the other site" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(state.spare);
    await expect(valueOf(locationCard(page), detail.location.site)).toHaveText(FX.siteB);
    const dialog = await openDialog(page, copy.dialogs.moveEquipment.trigger, buttonsOf(page));
    await expect(dialog.getByLabel(copy.dialogs.moveEquipment.operationLabel, { exact: true }).getByRole("option").last()).toHaveText(p.muleto);
    await dialog.getByLabel(copy.dialogs.moveEquipment.operationLabel, { exact: true }).selectOption({ label: p.muleto });
    await expect(dialog.getByLabel(p.siteLabel, { exact: true }).getByRole("option")).toHaveText([p.selectSite, WORLD_ORG.site]);
    await dialog.getByRole("button", { name: copy.common.cancel }).click();
    await submitMove(page, { operation: FX.opTwo, day: dayOffset(2), reason: "Back to work" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(state.active);
    await expect(valueOf(locationCard(page), detail.location.operation)).toHaveText(FX.opTwo);
    expect((await storedAssignments(id)).map((row) => [row.kind, row.operation_id, row.site_id])).toEqual([
      ["active", fx.opOne, readWorld().ids.site],
      ["spare", null, fx.siteB],
      ["active", fx.opTwo, readWorld().ids.site],
    ]);
    await gotoDetail(page, id, "RF-D3", "history");
    await expect(historyRows(page)).toHaveCount(3);
    await expect(historyRows(page).nth(1).locator(`td[data-label="${detail.history.operation}"]`)).toHaveText(NO_VALUE);
    await expect(historyRows(page).nth(1).locator(`td[data-label="${detail.history.site}"]`)).toHaveText(FX.siteB);
    await expect(historyRows(page).nth(1)).toContainText(detail.kinds.spare);
  });

  test("correct: a spare row opens as Muleto with its site, and choosing an operation makes it active", async ({ page }) => {
    const id = await seedUnit(fx, "RF-D4");
    await gotoDetail(page, id, "RF-D4");
    await submitAssign(page, { site: FX.siteB, day: dayOffset(-3), reason: "Loaded late" });
    await expectDialogClosed(page);
    await gotoDetail(page, id, "RF-D4", "history");
    const dialog = await openDialog(page, copy.dialogs.correctAssignment.trigger, historyRows(page).nth(0));
    await expect(dialog.getByLabel(copy.dialogs.correctAssignment.operationLabel, { exact: true }).locator("option:checked")).toHaveText(p.muleto);
    await expect(dialog.getByLabel(p.siteLabel, { exact: true }).locator("option:checked")).toHaveText(FX.siteB);
    await dialog.getByRole("button", { name: copy.common.cancel }).click();
    await submitCorrection(page, 0, { operation: FX.opOne, reason: "It was an active unit" });
    await expectDialogClosed(page);
    expect(await storedAssignments(id)).toMatchObject([{ kind: "active", operation_id: fx.opOne, site_id: readWorld().ids.site }]);
    await expect(historyRows(page).nth(0).locator(`td[data-label="${detail.history.operation}"]`)).toHaveText(FX.opOne);
  });

  test("replace: the outgoing unit stays as a Muleto at the SITE of the operation it leaves", async ({ page }) => {
    const outgoing = await seedUnit(fx, "RF-OUT", fx.opB);
    await seedUnit(fx, "RF-IN");
    await gotoDetail(page, outgoing, "RF-OUT");
    const dialog = await openDialog(page, copy.dialogs.replaceEquipment.trigger, buttonsOf(page));
    await expect(dialog.getByText(copy.dialogs.replaceEquipment.outgoingSpare)).toBeVisible();
    await expect(dialog.getByText("en el site de la operación que deja")).toBeVisible();
    await fillReplace(dialog, { day: dayOffset(1), outgoing: "spare", reason: "New unit arrived" });
    await dialog.getByLabel(copy.dialogs.replaceEquipment.incomingLabel, { exact: true }).selectOption({ label: `RF-IN - ${FX.types.hours}` });
    await submitReplace(dialog);
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(state.spare);
    await expect(valueOf(locationCard(page), detail.location.site)).toHaveText(FX.siteB);
    await expect(locationCard(page).getByText(detail.location.operation, { exact: true })).toHaveCount(0);
    expect((await storedAssignments(outgoing)).map((row) => [row.kind, row.operation_id, row.site_id])).toEqual([
      ["active", fx.opB, fx.siteB],
      ["spare", null, fx.siteB],
    ]);
    await gotoDetail(page, outgoing, "RF-OUT", "history");
    await expect(historyRows(page).nth(0).locator(`td[data-label="${detail.history.operation}"]`)).toHaveText(NO_VALUE);
    await expect(historyRows(page).nth(0).locator(`td[data-label="${detail.history.site}"]`)).toHaveText(FX.siteB);
  });
});

test.describe("the registration form on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(fresh);

  test("@mobile the fields stack in one column, stay inside the viewport and the submit button is reachable", async ({ page }) => {
    await page.goto("/fleet");
    await page.getByRole("button", { name: n.trigger, exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: n.title });
    await expect(dialog).toBeVisible();
    await showEverything(dialog);
    const box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    const first = await boxOf(dialog.getByLabel(f.internalCodeLabel, { exact: true }));
    const second = await boxOf(dialog.getByLabel(f.supplierLabel, { exact: true }));
    expect(second.x, "one column: the second field sits under the first").toBe(first.x);
    expect(second.y).toBeGreaterThan(first.y);
    const site = dialog.getByLabel(p.siteLabel, { exact: true });
    await site.scrollIntoViewIfNeeded();
    const siteBox = await boxOf(site);
    expect(siteBox.x + siteBox.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    await expectNoHorizontalScroll(page);
    const submit = dialog.getByRole("button", { name: n.submit, exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  });
});
