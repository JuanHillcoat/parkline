import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { resetCatalogs } from "../support/data";
import { openDialogOf } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../support/mobile-flows";
import {
  actionButtons, alertOf, correctReading, ddmmyyyy, dayOffset, expectLoaded, gotoReadings, historyRows, hoursOf, loadReading, messages,
  meteringAudit, openCorrect, openRecord, panelOf, r, rd, replaceMeter, rowWithBadge, rowWithValue, seedReading, seedReadingsBase, seedUnit,
  storedMeters, storedReadings, toolbar, today, type Base,
} from "../support/readings-flows";
import { storageStatePath } from "../support/world";

const info = copy.fleet.detail.info;
const NAME = "Admin E2E";
const ANALYST_NAME = "Analyst E2E";

let base: Base;

const fresh = async (): Promise<void> => {
  await resetCatalogs();
  base = await seedReadingsBase();
};

/** The value shown beside a label of the information card. */
const infoValue = (page: Page, label: string): Locator =>
  page.getByRole("region", { name: info.title }).locator("div.detail-row").filter({ has: page.getByText(label, { exact: true }) }).locator("dd");

const expectNothingNew = async (id: string, count: number): Promise<void> => {
  expect(await storedReadings(id)).toHaveLength(count);
};

for (const role of ["admin", "fleet_analyst"] as const) {
  test.describe(`loading readings as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("the first reading opens the meter and shows in the history and in the information card", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-FIRST" });
      await gotoReadings(page, id, "RDG-FIRST");
      await expect(panelOf(page).getByText(r.empty)).toBeVisible();
      await expect(toolbar(page).getByRole("button", { name: rd.replaceMeter.trigger })).toHaveCount(0);
      const dialog = await loadReading(page, { value: "100", reason: "Primera carga" });
      await expectLoaded(page);
      await expect(dialog).toBeHidden();
      await expect(historyRows(page)).toHaveCount(1);
      const row = historyRows(page).first();
      await expect(row).toContainText(ddmmyyyy(today()));
      await expect(row).toContainText("100,0 h");
      await expect(row).toContainText(r.kinds.reading);
      await expect(row).toContainText(r.you);
      await expect(row).toContainText("Primera carga");
      await expect(panelOf(page)).toContainText(r.meterOpened);
      await expect(panelOf(page)).toContainText(ddmmyyyy(today()));
      expect(await storedMeters(id)).toEqual([{ kind: "hours", opened_on: today(), closed_on: null }]);
      expect((await storedReadings(id)).map((x) => [x.kind, x.value_tenths])).toEqual([["reading", 1000]]);
      expect((await meteringAudit(id)).map((x) => x.action)).toEqual(["metering.reading.create"]);
      await page.goto(`/fleet/equipment/${id}`);
      await expect(infoValue(page, info.lastReading)).toHaveText(`100,0 h (${ddmmyyyy(today())})`);
    });

    test("several readings accumulate, newest first, and a comma is accepted as the decimal mark", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-SEVERAL", readings: [[-5, 100]] });
      await gotoReadings(page, id, "RDG-SEVERAL");
      await loadReading(page, { day: dayOffset(-3), value: "120,5" });
      await expectLoaded(page);
      await loadReading(page, { day: dayOffset(-1), value: "130" });
      await expectLoaded(page);
      await expect(historyRows(page)).toHaveCount(3);
      await expect(historyRows(page).nth(0)).toContainText("130,0 h");
      await expect(historyRows(page).nth(1)).toContainText("120,5 h");
      await expect(historyRows(page).nth(2)).toContainText("100,0 h");
    });

    test("shows the hours of the last 30 days from the readings around the window", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-HOURS", readings: [[-40, 100], [-20, 150], [0, 160]] });
      await gotoReadings(page, id, "RDG-HOURS");
      await expect(hoursOf(page)).toHaveText("60,0 h");
      await expect(panelOf(page).getByText(r.incomplete)).toHaveCount(0);
    });

    test("flags the hours as incomplete when the window has fewer than two readings", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-INCOMPLETE", readings: [[-2, 100]] });
      await gotoReadings(page, id, "RDG-INCOMPLETE");
      await expect(hoursOf(page)).toHaveText("0,0 h");
      await expect(panelOf(page).getByText(r.incomplete)).toBeVisible();
    });

    test("a lower value is refused with the hint to replace the meter and stores nothing", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-LOWER", readings: [[-2, 500]] });
      await gotoReadings(page, id, "RDG-LOWER");
      const dialog = await loadReading(page, { value: "400" });
      await expect(alertOf(dialog)).toHaveText(messages.reading_out_of_order);
      await expect(alertOf(dialog)).toContainText("reemplazo de medidor");
      await expectNothingNew(id, 1);
      expect(await meteringAudit(id)).toHaveLength(1);
    });

    test("a future day is refused and stores nothing", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-FUTURE", readings: [[-2, 500]] });
      await gotoReadings(page, id, "RDG-FUTURE");
      const dialog = await loadReading(page, { day: dayOffset(2), value: "600" });
      await expect(alertOf(dialog)).toHaveText(messages.reading_in_future);
      await expectNothingNew(id, 1);
    });

    test("a value with two decimals is refused and stores nothing", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-DECIMALS", readings: [[-2, 500]] });
      await gotoReadings(page, id, "RDG-DECIMALS");
      const dialog = await loadReading(page, { value: "600.55" });
      await expect(alertOf(dialog)).toHaveText(messages.invalid_reading_value);
      await expectNothingNew(id, 1);
    });

    test("an empty or non numeric value is refused and stores nothing", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-EMPTY-VALUE", readings: [[-2, 500]] });
      await gotoReadings(page, id, "RDG-EMPTY-VALUE");
      const empty = await loadReading(page, { value: "" });
      await expect(alertOf(empty)).toHaveText(messages.invalid_reading_value);
      await empty.getByLabel(rd.recordReading.valueLabel, { exact: true }).fill("abc");
      await empty.getByRole("button", { name: rd.recordReading.submit, exact: true }).click();
      await expect(alertOf(empty)).toHaveText(messages.invalid_reading_value);
      await expectNothingNew(id, 1);
    });

    test("the day of the form defaults to today and the reason is optional", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-DEFAULTS", readings: [[-2, 500]] });
      await gotoReadings(page, id, "RDG-DEFAULTS");
      const dialog = await openRecord(page);
      await expect(dialog.getByLabel(rd.recordReading.dayLabel, { exact: true })).toHaveValue(today());
      await expect(dialog.getByLabel(rd.recordReading.reasonLabel, { exact: true })).not.toHaveAttribute("required", "");
    });

    test("an old reading goes between its neighbors and a value outside them is refused", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-BACKDATE", readings: [[-10, 100], [-2, 200]] });
      await gotoReadings(page, id, "RDG-BACKDATE");
      const refused = await loadReading(page, { day: dayOffset(-5), value: "250" });
      await expect(alertOf(refused)).toHaveText(messages.reading_out_of_order);
      await refused.getByLabel(rd.recordReading.valueLabel, { exact: true }).fill("150");
      await refused.getByRole("button", { name: rd.recordReading.submit, exact: true }).click();
      await expectLoaded(page);
      await expect(historyRows(page)).toHaveCount(3);
      await expect(historyRows(page).nth(1)).toContainText("150,0 h");
    });
  });

  test.describe(`correcting a reading as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("the dialog opens with the current value and needs a reason", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-CORR-REASON", readings: [[-3, 100], [-1, 200]] });
      await gotoReadings(page, id, "RDG-CORR-REASON");
      const dialog = await openCorrect(page, rowWithValue(page, "200,0 h"));
      await expect(dialog.getByLabel(rd.correctReading.valueLabel, { exact: true })).toHaveValue("200.0");
      await dialog.getByLabel(rd.correctReading.valueLabel, { exact: true }).fill("210");
      await dialog.getByRole("button", { name: rd.correctReading.submit, exact: true }).click();
      await expect(alertOf(dialog)).toHaveText(messages.reason_required);
      await expectNothingNew(id, 2);
    });

    test("keeps the original visible as corrected, shows the new value and audits the reason", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-CORR", readings: [[-3, 100], [-1, 200]] });
      await gotoReadings(page, id, "RDG-CORR");
      await correctReading(page, rowWithValue(page, "200,0 h"), { value: "190,5", reason: "Error de tipeo" });
      await expectLoaded(page);
      await expect(historyRows(page)).toHaveCount(3);
      const original = rowWithBadge(page, r.superseded);
      await expect(original).toHaveCount(1);
      await expect(original).toContainText("200,0 h");
      await expect(original.getByRole("button", { name: rd.correctReading.trigger })).toHaveCount(0);
      const corrected = rowWithBadge(page, r.kinds.correction);
      await expect(corrected).toContainText("190,5 h");
      await expect(corrected).toContainText("Error de tipeo");
      await expect(corrected.locator(".badge").getByText(r.superseded, { exact: true })).toHaveCount(0);
      const stored = await storedReadings(id);
      expect(stored.map((x) => [x.kind, x.value_tenths, x.corrects])).toEqual([["reading", 1000, false], ["reading", 2000, false], ["correction", 1905, true]]);
      const audit = await meteringAudit(id);
      expect(audit.at(-1)).toMatchObject({ action: "metering.reading.correct", reason: "Error de tipeo" });
      await page.goto(`/fleet/equipment/${id}`);
      await expect(infoValue(page, info.lastReading)).toHaveText(`190,5 h (${ddmmyyyy(dayOffset(-1))})`);
    });

    test("a value that does not fit between the neighbors is refused and stores nothing", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-CORR-FIT", readings: [[-10, 100], [-5, 200], [-1, 300]] });
      await gotoReadings(page, id, "RDG-CORR-FIT");
      const dialog = await correctReading(page, rowWithValue(page, "200,0 h"), { value: "400", reason: "Prueba" });
      await expect(alertOf(dialog)).toHaveText(messages.reading_out_of_order);
      await expectNothingNew(id, 3);
    });
  });

  test.describe(`replacing the meter as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("closes the old meter and opens the new one, and the hours count across the replacement", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-REPLACE", readings: [[-40, 100], [-20, 200]] });
      await gotoReadings(page, id, "RDG-REPLACE");
      await replaceMeter(page, { day: dayOffset(-10), final: "250", initial: "5", reason: "Medidor roto" });
      await expectLoaded(page);
      await loadReading(page, { day: dayOffset(0), value: "15" });
      await expectLoaded(page);
      await expect(rowWithBadge(page, r.kinds.replacement_close)).toContainText("250,0 h");
      await expect(rowWithBadge(page, r.kinds.replacement_close)).toContainText("Medidor roto");
      await expect(rowWithBadge(page, r.kinds.replacement_open)).toContainText("5,0 h");
      await expect(historyRows(page).first()).toContainText("15,0 h");
      await expect(hoursOf(page)).toHaveText("160,0 h");
      const meters = await storedMeters(id);
      expect(meters.map((m) => m.closed_on)).toEqual([dayOffset(-10), null]);
      expect(await meteringAudit(id)).toMatchObject([{ action: "metering.reading.create" }, { action: "metering.reading.create" }, { action: "metering.meter.replace", reason: "Medidor roto" }, { action: "metering.reading.create" }]);
    });

    test("needs a reason and a final value that is not below the last reading", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-REPLACE-BAD", readings: [[-5, 100], [-2, 200]] });
      await gotoReadings(page, id, "RDG-REPLACE-BAD");
      const dialog = await replaceMeter(page, { final: "250", initial: "5" });
      await expect(alertOf(dialog)).toHaveText(messages.reason_required);
      await dialog.getByLabel(copy.common.reason, { exact: true }).fill("Roto");
      await dialog.getByLabel(rd.replaceMeter.finalLabel, { exact: true }).fill("150");
      await dialog.getByRole("button", { name: rd.replaceMeter.submit, exact: true }).click();
      await expect(alertOf(dialog)).toHaveText(messages.meter_replacement_invalid);
      await dialog.getByLabel(rd.replaceMeter.initialLabel, { exact: true }).fill("");
      await dialog.getByLabel(rd.replaceMeter.finalLabel, { exact: true }).fill("250");
      await dialog.getByRole("button", { name: rd.replaceMeter.submit, exact: true }).click();
      await expect(alertOf(dialog)).toHaveText(messages.invalid_reading_value);
      await expectNothingNew(id, 2);
      expect(await storedMeters(id)).toHaveLength(1);
    });
  });
}

test.describe("what the tab shows for each kind of equipment", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(fresh);

  test("an asset type without a meter shows only its notice and no last reading", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-NONE", type: "none" });
    await gotoReadings(page, id, "RDG-NONE");
    await expect(panelOf(page)).toContainText(r.noMeter);
    await expect(actionButtons(page)).toHaveCount(0);
    await expect(page.getByRole("table", { name: r.caption })).toHaveCount(0);
    await expect(hoursOf(page)).toHaveCount(0);
    await page.goto(`/fleet/equipment/${id}`);
    await expect(page.getByText(info.lastReading, { exact: true })).toHaveCount(0);
  });

  test("an archived equipment keeps its history and offers no action", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-ARCHIVED", place: "none", readings: [[-3, 100], [-1, 200]], archive: true });
    await gotoReadings(page, id, "RDG-ARCHIVED");
    await expect(historyRows(page)).toHaveCount(2);
    await expect(actionButtons(page)).toHaveCount(0);
  });

  test("an equipment that was never assigned can still be read and loaded by a company-wide writer", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-UNASSIGNED", place: "none" });
    await gotoReadings(page, id, "RDG-UNASSIGNED");
    await loadReading(page, { value: "10" });
    await expectLoaded(page);
    await expect(historyRows(page)).toHaveCount(1);
  });

  test("the unit follows the meter: hours show h and kilometers show km", async ({ page }) => {
    const hours = await seedUnit(base, { code: "RDG-UNIT-H", readings: [[-3, 100]] });
    const km = await seedUnit(base, { code: "RDG-UNIT-KM", type: "km", readings: [[-3, 12_345.6]] });
    await gotoReadings(page, hours, "RDG-UNIT-H");
    await expect(historyRows(page).first()).toContainText("100,0 h");
    await expect(panelOf(page)).toContainText(copy.fleet.meter.hours);
    await gotoReadings(page, km, "RDG-UNIT-KM");
    await expect(historyRows(page).first()).toContainText("12.345,6 km");
    await expect(panelOf(page)).toContainText(copy.fleet.meter.km);
    await expect(hoursOf(page)).toHaveText("0,0 km");
  });
});

test.describe("who loaded a reading", () => {
  test.beforeEach(fresh);

  test("the administrator sees the name of another user, and You on their own rows", async ({ browser, baseURL }) => {
    const id = await seedUnit(base, { code: "RDG-WHO-ADMIN" });
    const analyst = await browser.newContext({ baseURL, storageState: storageStatePath("fleet_analyst") });
    const analystPage = await analyst.newPage();
    await gotoReadings(analystPage, id, "RDG-WHO-ADMIN");
    await loadReading(analystPage, { value: "100" });
    await expectLoaded(analystPage);
    await expect(historyRows(analystPage).first()).toContainText(r.you);
    await analyst.close();
    const admin = await browser.newContext({ baseURL, storageState: storageStatePath("admin") });
    const adminPage = await admin.newPage();
    await gotoReadings(adminPage, id, "RDG-WHO-ADMIN");
    await expect(historyRows(adminPage).first()).toContainText(ANALYST_NAME);
    await expect(historyRows(adminPage).first()).not.toContainText(r.you);
    await admin.close();
  });
});

test.describe("a stale form", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(fresh);

  test("a reading added meanwhile makes the old form answer the typed error and change nothing", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-STALE", readings: [[-3, 100]] });
    await gotoReadings(page, id, "RDG-STALE");
    const dialog = await openRecord(page, { value: "150" });
    await seedReading(id, -1, 400);
    await dialog.getByRole("button", { name: rd.recordReading.submit, exact: true }).click();
    await expect(alertOf(dialog)).toHaveText(messages.reading_out_of_order);
    await expectNothingNew(id, 2);
  });

  test("a correction whose neighbor changed meanwhile is refused", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-STALE-CORR", readings: [[-5, 100], [-1, 300]] });
    await gotoReadings(page, id, "RDG-STALE-CORR");
    const dialog = await openCorrect(page, rowWithValue(page, "100,0 h"));
    await seedReading(id, -3, 200);
    await dialog.getByLabel(rd.correctReading.valueLabel, { exact: true }).fill("250");
    await dialog.getByLabel(copy.common.reason, { exact: true }).fill("Prueba");
    await dialog.getByRole("button", { name: rd.correctReading.submit, exact: true }).click();
    await expect(alertOf(dialog)).toHaveText(messages.reading_out_of_order);
    await expectNothingNew(id, 3);
  });
});

for (const role of ["supervisor", "manager", "viewer"] as const) {
  test.describe(`${role} only reads the readings`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(fresh);

    test("sees the tab, the history and the hours but no button, with or without readings", async ({ page }) => {
      const withReadings = await seedUnit(base, { code: "RDG-RO", readings: [[-3, 100], [-1, 160]] });
      const empty = await seedUnit(base, { code: "RDG-RO-EMPTY" });
      await gotoReadings(page, withReadings, "RDG-RO");
      await expect(historyRows(page)).toHaveCount(2);
      await expect(hoursOf(page)).toBeVisible();
      await expect(actionButtons(page)).toHaveCount(0);
      await expect(page.getByRole("group", { name: r.toolbar })).toHaveCount(0);
      await gotoReadings(page, empty, "RDG-RO-EMPTY");
      await expect(panelOf(page)).toContainText(r.emptyReadOnly);
      await expect(actionButtons(page)).toHaveCount(0);
    });

    test("does not learn who loaded a reading: only a company-wide administrator lists users", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-WHO", readings: [[-3, 100]] });
      await gotoReadings(page, id, "RDG-WHO");
      await expect(historyRows(page).first()).not.toContainText(NAME);
    });

    test("sees the last reading in the information card", async ({ page }) => {
      const id = await seedUnit(base, { code: "RDG-RO-INFO", readings: [[-1, 160]] });
      await page.goto(`/fleet/equipment/${id}`);
      await expect(infoValue(page, info.lastReading)).toHaveText(`160,0 h (${ddmmyyyy(dayOffset(-1))})`);
    });
  });
}

test.describe("scope of the readings", () => {
  test.use({ storageState: storageStatePath("supervisor") });
  test.beforeEach(fresh);

  test("a supervisor gets the not-found page for the readings of an equipment outside the scope", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-OUT", place: "other", readings: [[-1, 160]] });
    await page.goto(`/fleet/equipment/${id}?tab=readings`);
    await expect(page.getByRole("heading", { level: 1, name: copy.errors.notFound.title })).toBeVisible();
    await expect(page.getByText("160,0 h")).toHaveCount(0);
  });

  test("the same goes for an unassigned equipment, which only company-wide readers see", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-OUT-FREE", place: "none", readings: [[-1, 160]] });
    await page.goto(`/fleet/equipment/${id}?tab=readings`);
    await expect(page.getByRole("heading", { level: 1, name: copy.errors.notFound.title })).toBeVisible();
  });
});

test.describe("readings on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(fresh);

  async function expectFits(dialog: Locator, submit: string): Promise<void> {
    await expect(dialog).toBeVisible();
    const box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    const button = dialog.getByRole("button", { name: submit, exact: true });
    await button.scrollIntoViewIfNeeded();
    const b = await boxOf(button);
    expect(b.y + b.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
  }

  test("@mobile the tab is usable: the history is stacked cards and the page does not scroll sideways", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-MOBILE", readings: [[-3, 100], [-1, 160]] });
    await gotoReadings(page, id, "RDG-MOBILE");
    await expect(historyRows(page)).toHaveCount(2);
    await expect(historyRows(page).first().locator("td[data-label]").first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expect(toolbar(page).getByRole("button", { name: rd.recordReading.trigger })).toBeVisible();
  });

  test("@mobile the dialogs fit the viewport and reach their submit button", async ({ page }) => {
    const id = await seedUnit(base, { code: "RDG-MOBILE-DIALOGS", readings: [[-3, 100], [-1, 160]] });
    await gotoReadings(page, id, "RDG-MOBILE-DIALOGS");
    await page.getByRole("button", { name: rd.recordReading.trigger, exact: true }).tap();
    await expectFits(openDialogOf(page), rd.recordReading.submit);
    await openDialogOf(page).getByRole("button", { name: copy.common.cancel }).tap();
    await expect(openDialogOf(page)).toBeHidden();
    await page.getByRole("button", { name: rd.replaceMeter.trigger, exact: true }).tap();
    await expectFits(openDialogOf(page), rd.replaceMeter.submit);
    await expectNoHorizontalScroll(page);
  });
});
