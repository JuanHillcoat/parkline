import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  buttonNamed,
  infoCard,
  locationCard,
  maintenanceCard,
  menuOf,
  moreToggle,
  observationsCard,
  recordButton,
  ringValue,
  rowValueOf,
  titleOf,
  usageCard,
} from "../support/detail-page";
import { openDialog, openDialogOf } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, MIN_TAP_TARGET, VIEWPORT_WIDTH } from "../support/mobile-flows";
import { expectLoaded as expectImageLoaded, flatPng } from "../support/image-flows";
import { dayOffset, expectLoaded, loadReading } from "../support/readings-flows";
import { readWorld, storageStatePath } from "../support/world";

const t = copy.fleet.detail;
const m = t.maintenance;
const u = t.usage;
const d = copy.dialogs;

type Cycle = { ok: string; soon: string; late: string; noMeter: string; noReadings: string; noInterval: string; noted: string; plain: string };

/**
 * Equipment in OPERATION E2E, each with the readings that put it in one state of the preventive cycle (interval
 * 250 h). A first reading a year and a bit ago and a second one today keep the figures the same whatever day the
 * suite runs: the whole difference falls in the current month.
 *   CYC-OK        100 -> 230: 130 accumulated of 250, 120 left, next 350
 *   CYC-SOON      100 -> 300: 200 accumulated, 50 left
 *   CYC-LATE      100 -> 400: 300 accumulated, 50 past due
 *   CYC-NOMETER   asset type without a meter
 *   CYC-NOREAD    hours type with an interval and no readings
 *   CYC-NOINT     hours type without an interval, with readings
 *   CYC-NOTED     with observations; CYC-PLAIN without
 */
async function seedCycle(): Promise<Cycle> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplier = await seeder.supplier("Cycle supplier");
    const crane = await seeder.assetType("Cycle crane", "hours", 250);
    const plain = await seeder.assetType("Cycle plain", "hours");
    const cart = await seeder.assetType("Cycle cart", "none");
    const unit = async (code: string, type: string, readings: readonly (readonly [number, number])[] = [], observations?: string) => {
      const id = await seeder.equipment({ supplierId: supplier, assetTypeId: type, internalCode: code, ...(observations === undefined ? {} : { observations }) });
      await seeder.assign({ equipmentId: id, operationId: world.operation, day: "2026-01-05", reason: "Loaded late" });
      for (const [offset, value] of readings) await seeder.reading(id, dayOffset(offset), value);
      return id;
    };
    return {
      ok: await unit("CYC-OK", crane, [[-400, 100], [0, 230]]),
      soon: await unit("CYC-SOON", crane, [[-400, 100], [0, 300]]),
      late: await unit("CYC-LATE", crane, [[-400, 100], [0, 400]]),
      noMeter: await unit("CYC-NOMETER", cart),
      noReadings: await unit("CYC-NOREAD", crane),
      noInterval: await unit("CYC-NOINT", plain, [[-400, 10], [0, 20]]),
      noted: await unit("CYC-NOTED", crane, [], "Left mast needs paint\nSecond line"),
      plain: await unit("CYC-PLAIN", crane),
    };
  } finally {
    await seeder.close();
  }
}

async function gotoDetail(page: Page, id: string, code: string, query = ""): Promise<void> {
  await page.goto(`/fleet/equipment/${id}${query}`);
  await expect(page.getByRole("heading", { level: 1, name: titleOf(code) })).toBeVisible();
}

/** A screen wide enough for four cards in a row next to the sidebar. */
const WIDE = 1600;

const ring = (page: Page): Locator => maintenanceCard(page).locator(".ring");
const chartPoints = (page: Page): Locator => usageCard(page).locator("svg circle");
const stateOf = (page: Page): Locator => rowValueOf(maintenanceCard(page), m.state);

/** The `YYYY-MM` of the month before the current one, and its month number (1-12) and year. */
function previousMonth(): { value: string; month: number; year: number } {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const month = date.getUTCMonth() + 1;
  return { value: `${String(date.getUTCFullYear())}-${String(month).padStart(2, "0")}`, month, year: date.getUTCFullYear() };
}

test.describe("equipment detail cards as a fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("Horas y mantenimiento shows the accumulated hours in the ring and the rows beside it", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const card = maintenanceCard(page);
    await expect(ringValue(page)).toHaveText("130 hs");
    await expect(card.locator(".ring-caption")).toHaveText(m.accumulated);
    await expect(card.getByText(m.ringLabel(52))).toBeAttached();
    await expect(rowValueOf(card, m.month.hours)).toHaveText("130 hs");
    await expect(rowValueOf(card, m.remaining.hours)).toHaveText("120 hs");
    await expect(rowValueOf(card, m.remaining.hours)).not.toHaveAttribute("data-tone", /.+/u);
    await expect(rowValueOf(card, m.next)).toHaveText("350 hs");
    await expect(stateOf(page).locator(".badge-ok")).toHaveText(m.states.ok);
  });

  test("the ring is painted blue for the consumed share and grey for the rest", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const background = await ring(page).evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(background).toContain("conic-gradient");
    expect(background).toMatch(/52%/u);
  });

  test("a preventive that is due soon turns the remaining hours and the state amber", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.soon, "CYC-SOON");
    const card = maintenanceCard(page);
    await expect(ringValue(page)).toHaveText("200 hs");
    await expect(rowValueOf(card, m.remaining.hours)).toHaveText("50 hs");
    await expect(rowValueOf(card, m.remaining.hours)).toHaveAttribute("data-tone", "warn");
    await expect(stateOf(page).locator(".badge-warn")).toHaveText(m.states.due_soon);
  });

  test("an overdue preventive is red and shows a negative remainder", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.late, "CYC-LATE");
    const card = maintenanceCard(page);
    await expect(ringValue(page)).toHaveText("300 hs");
    await expect(card.getByText(m.ringLabel(100))).toBeAttached();
    await expect(rowValueOf(card, m.remaining.hours)).toHaveText("-50 hs");
    await expect(rowValueOf(card, m.remaining.hours)).toHaveAttribute("data-tone", "danger");
    await expect(stateOf(page).locator(".badge-danger")).toHaveText(m.states.overdue);
  });

  test("the card says what is missing instead of showing numbers", async ({ page }) => {
    const ids = await seedCycle();
    const cases: readonly (readonly [string, string, string])[] = [
      [ids.noMeter, "CYC-NOMETER", m.noMeter],
      [ids.noReadings, "CYC-NOREAD", m.noReadings],
      [ids.noInterval, "CYC-NOINT", m.noInterval],
    ];
    for (const [id, code, reason] of cases) {
      await gotoDetail(page, id, code);
      await expect(maintenanceCard(page).getByText(reason, { exact: true }), code).toBeVisible();
      await expect(ring(page), code).toHaveCount(0);
    }
  });

  test("the usage chart has the fixed scale, the contracted line, the legend and the months up to the current one", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const card = usageCard(page);
    const now = new Date();
    const current = now.getUTCMonth();
    await expect(card.getByRole("img", { name: u.label(u.legend.hours, now.getUTCFullYear()) })).toBeVisible();
    await expect(card.getByText(u.legend.hours, { exact: true })).toBeVisible();
    await expect(card.getByText(u.contracted, { exact: true })).toBeVisible();
    await expect(card.getByText(u.period, { exact: true })).toBeVisible();
    const labels = card.locator("svg text");
    for (const tick of ["0", "100", "200", "300", ...u.months]) await expect(labels.filter({ hasText: new RegExp(`^${tick}$`, "u") }), tick).toHaveCount(1);
    await expect(labels.filter({ hasText: /^400$/u })).toHaveCount(0);
    // A horizontal line has a zero-height box, which Playwright never calls visible: assert it is drawn instead
    await expect(card.getByTestId("chart-reference")).toHaveCount(1);
    await expect(chartPoints(page)).toHaveCount(current + 1);
    const rows = card.getByRole("table", { name: u.valuesCaption }).locator("tr");
    await expect(rows).toHaveCount(current + 1);
    for (const [index, month] of u.months.slice(0, current + 1).entries()) {
      await expect(rows.nth(index).locator("th")).toHaveText(month);
      await expect(rows.nth(index).locator("td")).toHaveText(index === current ? "130 hs" : "0 hs");
    }
  });

  test("the contracted line sits at 250 on the same scale as the ticks", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const y = async (locator: Locator): Promise<number> => (await boxOf(locator)).y + (await boxOf(locator)).height / 2;
    const labels = usageCard(page).locator("svg text");
    const [zero, hundred, twoHundred] = [await y(labels.filter({ hasText: /^0$/u })), await y(labels.filter({ hasText: /^100$/u })), await y(labels.filter({ hasText: /^200$/u }))];
    const line = await y(usageCard(page).getByTestId("chart-reference"));
    expect(hundred).toBeLessThan(zero);
    const perHundred = zero - hundred;
    expect(Math.abs(zero - line - 2.5 * perHundred), "250 is two and a half steps above zero").toBeLessThan(3);
    expect(twoHundred).toBeLessThan(hundred);
  });

  test("choosing another month redraws the card for that period and keeps the tab", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK", "?tab=readings");
    const previous = previousMonth();
    const select = usageCard(page).getByLabel(u.period, { exact: true });
    await expect(select.locator("option")).toHaveCount(24);
    await expect(select.locator("option").first()).toHaveAttribute("value", /^\d{4}-\d{2}$/u);
    await select.selectOption(previous.value);
    await expect(page).toHaveURL(new RegExp(`tab=readings.*period=${previous.value}|period=${previous.value}.*tab=readings`, "u"));
    await expect(usageCard(page).getByRole("img", { name: u.label(u.legend.hours, previous.year) })).toBeVisible();
    await expect(chartPoints(page)).toHaveCount(previous.month);
    await expect(usageCard(page).getByLabel(u.period, { exact: true })).toHaveValue(previous.value);
    await expect(rowValueOf(maintenanceCard(page), m.month.hours)).toHaveText("0 hs");
    await expect(ringValue(page)).toHaveText("130 hs");
    await expect(page.getByRole("link", { name: t.tabs.readings })).toHaveAttribute("aria-current", "page");
  });

  test("a period typed by hand that is not valid shows the current month", async ({ page }) => {
    const ids = await seedCycle();
    const current = new Date().getUTCMonth() + 1;
    for (const bad of ["bogus", "2999-01", "2026-13"]) {
      await gotoDetail(page, ids.ok, "CYC-OK", `?period=${bad}`);
      await expect(chartPoints(page), bad).toHaveCount(current);
    }
  });

  test("the usage card of an asset type without a meter says so and draws nothing", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.noMeter, "CYC-NOMETER");
    await expect(usageCard(page).getByText(u.noMeter)).toBeVisible();
    await expect(usageCard(page).locator("svg")).toHaveCount(0);
  });

  test("the Observaciones card shows the text, or says there are none", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.noted, "CYC-NOTED");
    await expect(observationsCard(page)).toContainText("Left mast needs paint");
    await expect(observationsCard(page)).toContainText("Second line");
    await gotoDetail(page, ids.plain, "CYC-PLAIN");
    await expect(observationsCard(page).getByText(t.observations.none, { exact: true })).toBeVisible();
  });

  test("Registrar horas in the header opens the load dialog and the cycle appears after the first reading", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.noReadings, "CYC-NOREAD");
    await expect(maintenanceCard(page).getByText(m.noReadings)).toBeVisible();
    await expect(recordButton(page)).toBeVisible();
    const dialog = await loadReading(page, { value: "100", reason: "First load" });
    await expectLoaded(page);
    await expect(dialog).toBeHidden();
    await expect(ringValue(page)).toHaveText("0 hs");
    await expect(rowValueOf(maintenanceCard(page), m.next)).toHaveText("350 hs");
  });
});

test.describe("equipment detail layout on a desktop", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("from 1500 pixels three cards of one fixed height share the first row and the usage chart spans the row below", async ({ page }) => {
    const ids = await seedCycle();
    await page.setViewportSize({ width: WIDE, height: 900 });
    await gotoDetail(page, ids.ok, "CYC-OK");
    const info = await boxOf(infoCard(page));
    const location = await boxOf(locationCard(page));
    const maintenance = await boxOf(maintenanceCard(page));
    const usage = await boxOf(usageCard(page));
    for (const box of [location, maintenance]) expect(Math.abs(box.y - info.y)).toBeLessThanOrEqual(1);
    for (const box of [info, location, maintenance]) expect(Math.abs(box.height - 292)).toBeLessThanOrEqual(1);
    expect(info.x).toBeLessThan(location.x);
    expect(location.x).toBeLessThan(maintenance.x);
    expect(info.width).toBeGreaterThan(location.width);
    expect(maintenance.width).toBeGreaterThan(location.width);
    expect(usage.y).toBeGreaterThan(info.y + info.height - 1);
    expect(Math.abs(usage.x - info.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(usage.x + usage.width - (maintenance.x + maintenance.width))).toBeLessThanOrEqual(1);
  });

  test("the photo is drawn whole inside its box and the card whatever its aspect ratio", async ({ page }) => {
    const seeder = await openSeeder();
    const photos = { "PHO-WIDE": flatPng(640, 480), "PHO-SQUARE": flatPng(500, 500), "PHO-TALL": flatPng(300, 500) };
    const ids: Record<string, string> = {};
    try {
      const supplier = await seeder.supplier("Photo supplier");
      const type = await seeder.assetType("Photo type", "none");
      for (const [code, bytes] of Object.entries(photos)) {
        ids[code] = await seeder.equipment({ supplierId: supplier, assetTypeId: type, internalCode: code });
        await seeder.assign({ equipmentId: ids[code], operationId: readWorld().ids.operation, day: "2026-01-05", reason: "Loaded late" });
        await seeder.equipmentImage(ids[code], bytes);
      }
    } finally {
      await seeder.close();
    }
    await page.setViewportSize({ width: WIDE, height: 900 });
    for (const [code, id] of Object.entries(ids)) {
      await gotoDetail(page, id, code);
      const photo = infoCard(page).getByRole("img", { name: t.info.photoLabel });
      await expectImageLoaded(photo);
      const drawn = await photo.evaluate((img: HTMLImageElement) => {
        const box = img.getBoundingClientRect();
        const [x = "", y = ""] = getComputedStyle(img).objectPosition.match(/calc\([^)]*\)|\S+/gu) ?? [];
        // Resolves `P%`, `Npx` and `calc(P% + Npx)` against the free space around the drawn picture.
        const offset = (token: string, free: number): number => {
          const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/u.exec(token);
          if (calc !== null) return (free * parseFloat(calc[1] ?? "0")) / 100 + (calc[2] === "-" ? -1 : 1) * parseFloat(calc[3] ?? "0");
          return token.endsWith("%") ? (free * parseFloat(token)) / 100 : parseFloat(token);
        };
        const scale = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
        const width = img.naturalWidth * scale;
        const height = img.naturalHeight * scale;
        return { box: { left: box.left, top: box.top, right: box.right, bottom: box.bottom }, width, height, dx: offset(x, box.width - width), dy: offset(y, box.height - height) };
      });
      const card = await boxOf(infoCard(page));
      const left = drawn.box.left + drawn.dx;
      const top = drawn.box.top + drawn.dy;
      expect(left, `${code}: the left of the picture is inside its box`).toBeGreaterThanOrEqual(drawn.box.left - 0.5);
      expect(left + drawn.width, `${code}: the right of the picture is inside its box`).toBeLessThanOrEqual(drawn.box.right + 0.5);
      expect(top, `${code}: the top of the picture is inside its box`).toBeGreaterThanOrEqual(drawn.box.top - 0.5);
      expect(top + drawn.height, `${code}: the foot of the picture is inside its box`).toBeLessThanOrEqual(drawn.box.bottom + 0.5);
      expect(drawn.box.right, `${code}: the box is inside the card`).toBeLessThanOrEqual(card.x + card.width + 0.5);
    }
  });

  test("general information spreads its rows over the fixed card height whatever the number of rows or lines", async ({ page }) => {
    const seeder = await openSeeder();
    const units = {
      "FIX-SHORT": { brand: "BRANDX", model: "Q1", batteryKind: "combustion" as const },
      "FIX-LONG": { brand: "BRANDX QX LIFTS", model: "SINGLE SR2500", batteryKind: "lead_acid" as const, batteryQuantity: 2 },
      "FIX-LEAD": { brand: "BRANDX", model: "Q1", batteryKind: "lead_acid" as const, batteryQuantity: 2 },
    };
    const ids: Record<string, string> = {};
    try {
      const supplier = await seeder.supplier("Fixed supplier");
      const type = await seeder.assetType("Fixed type", "none");
      for (const [code, unit] of Object.entries(units)) {
        ids[code] = await seeder.equipment({ supplierId: supplier, assetTypeId: type, internalCode: code, ...unit });
        await seeder.assign({ equipmentId: ids[code], operationId: readWorld().ids.operation, day: "2026-01-05", reason: "Loaded late" });
        await seeder.equipmentImage(ids[code], flatPng(640, 480));
      }
    } finally {
      await seeder.close();
    }
    await page.setViewportSize({ width: WIDE, height: 900 });
    const measured: Record<string, { rows: number; gap: number; height: number; footOff: number; steps: number[] }> = {};
    for (const [code, id] of Object.entries(ids)) {
      await gotoDetail(page, id, code);
      const card = infoCard(page);
      await expectImageLoaded(card.getByRole("img", { name: t.info.photoLabel }));
      measured[code] = await card.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const values = [...element.querySelectorAll(".info-list dd")];
        const last = (values[values.length - 1] as HTMLElement).getBoundingClientRect();
        const photo = (element.querySelector(".photo-image") as HTMLElement).getBoundingClientRect();
        const rects = values.map((value) => value.getBoundingClientRect());
        const steps = rects.slice(1).map((rect, index) => rect.top - (rects[index]?.bottom ?? 0));
        return { rows: values.length, gap: box.bottom - last.bottom, height: box.height, footOff: Math.abs(photo.bottom - last.bottom), steps };
      });
    }
    const short = measured["FIX-SHORT"];
    const long = measured["FIX-LONG"];
    const lead = measured["FIX-LEAD"];
    if (short === undefined || long === undefined || lead === undefined) throw new Error("All the cards must be measured");
    expect([short.rows, long.rows, lead.rows], "6 rows without the battery count, 7 with it").toEqual([6, 7, 7]);
    for (const card of [short, long, lead]) {
      expect(Math.abs(card.height - long.height), "the cards have the same height").toBeLessThanOrEqual(2);
      expect(Math.abs(card.gap - long.gap), "the last row ends at the same place in every card").toBeLessThanOrEqual(2);
      expect(card.gap, "little space is left between the last row and the bottom of the card").toBeLessThanOrEqual(16);
      expect(card.footOff, "the foot of the photo is on the last row").toBeLessThanOrEqual(2);
    }
    // A full card (two-line brand and model) keeps the 10px between its rows; the others spread theirs.
    for (const step of long.steps) expect(Math.abs(step - 10), "the rows of a full card stay 10px apart").toBeLessThanOrEqual(2);
    for (const card of [short, lead]) for (const step of card.steps) expect(step, "the rows of a card with spare room spread").toBeGreaterThan(12);
  });

  test("the information card has labels, values and the photo in three columns, the photo whole and beside the rows", async ({ page }) => {
    const ids = await seedCycle();
    await page.setViewportSize({ width: WIDE, height: 900 });
    await gotoDetail(page, ids.ok, "CYC-OK");
    const card = infoCard(page);
    const label = await boxOf(card.getByText(t.info.internalCode, { exact: true }));
    const value = await boxOf(rowValueOf(card, t.info.internalCode));
    const photo = card.getByRole("img", { name: t.info.photoLabel });
    const frame = await boxOf(photo);
    expect(label.x).toBeLessThan(value.x);
    expect(frame.x).toBeGreaterThan(value.x);
    const last = await boxOf(rowValueOf(card, t.info.batteryKind));
    expect(frame.y, "the photo starts beside the rows, not under them").toBeLessThan(last.y);
    expect(Math.abs(frame.y + frame.height - (last.y + last.height)), "the foot of the photo is on the last row").toBeLessThanOrEqual(2);
    expect(frame.height).toBeLessThanOrEqual(161);
    const names = [t.info.internalCode, t.info.assetType, t.info.brandModel, t.info.year, t.info.supplier, t.info.batteryKind];
    for (const name of names) await expect(card.getByText(name, { exact: true }), name).toBeVisible();
    await expect(card.getByText("N° de serie", { exact: true })).toHaveCount(0);
  });

  test("the title badge is squarer than the pills of the page", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const radius = (locator: Locator): Promise<string> => locator.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);
    expect(await radius(page.locator(".title-row .badge"))).toBe("4px");
    expect(parseFloat(await radius(stateOf(page).locator(".badge")))).toBeGreaterThan(10);
  });

  test("the first row of cards sits 20px from the sidebar and 20px from the right edge of the page", async ({ page }) => {
    await page.setViewportSize({ width: WIDE, height: 900 });
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const sidebar = await boxOf(page.locator("#app-sidebar"));
    const first = await boxOf(infoCard(page));
    const third = await boxOf(maintenanceCard(page));
    const pageRight = await page.evaluate(() => document.documentElement.clientWidth);
    expect(Math.abs(first.x - (sidebar.x + sidebar.width) - 20), "the space between the sidebar and the first card").toBeLessThanOrEqual(1);
    expect(Math.abs(pageRight - (third.x + third.width) - 20), "the space between the third card and the page edge").toBeLessThanOrEqual(1);
  });

  test("the cards are 8px apart and general information is 460px wide, Ubicación actual the narrowest", async ({ page }) => {
    await page.setViewportSize({ width: WIDE, height: 900 });
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const [info, location, maintenance, usage] = await Promise.all([
      boxOf(infoCard(page)),
      boxOf(locationCard(page)),
      boxOf(maintenanceCard(page)),
      boxOf(usageCard(page)),
    ]);
    expect(Math.abs(location.x - (info.x + info.width) - 8), "the space between cards 1 and 2").toBeLessThanOrEqual(1);
    expect(Math.abs(maintenance.x - (location.x + location.width) - 8), "the space between cards 2 and 3").toBeLessThanOrEqual(1);
    expect(Math.abs(usage.y - (info.y + info.height) - 8), "the space between the first row and the chart").toBeLessThanOrEqual(1);
    expect(Math.abs(info.width - 460), "the width of general information").toBeLessThanOrEqual(1);
    expect(location.width).toBeLessThan(maintenance.width);
  });

  test("the top bar carries the way back at the left and the account menu at the right", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const back = page.locator(".topbar").getByRole("link", { name: t.back });
    await expect(back).toBeVisible();
    await expect(page.locator("#content").getByRole("link", { name: t.back })).toHaveCount(0);
    const account = await boxOf(page.locator(".topbar .account-menu"));
    expect((await boxOf(back)).x).toBeLessThan(account.x);
    await back.click();
    await expect(page).toHaveURL(/\/fleet$/u);
  });

  test("Ubicación actual lists the place and carries the full width change button", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const card = locationCard(page);
    for (const label of [t.location.operation, t.location.site, t.location.division]) await expect(card.getByText(label, { exact: true }), label).toBeVisible();
    expect([t.location.site, t.location.division]).toEqual(["Site", "Negocio"]);
    const button = card.getByRole("button", { name: d.moveEquipment.trigger, exact: true });
    await expect(button).toBeVisible();
    await expect(card.getByRole("button", { name: d.assignEquipment.trigger, exact: true })).toHaveCount(0);
    const [frame, inner] = [await boxOf(card), await boxOf(button)];
    expect(inner.width).toBeGreaterThan(frame.width - 60);
    await expect(card.getByText("Proveedor", { exact: true })).toHaveCount(0);
    await expect(card.getByText("Tipo de asignación", { exact: true })).toHaveCount(0);
    await expect(rowValueOf(infoCard(page), t.info.supplier)).toHaveText("CYCLE SUPPLIER");
  });

  test("below 1500 pixels general information takes a row of its own and the other two share the next", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const info = await boxOf(infoCard(page));
    const location = await boxOf(locationCard(page));
    const maintenance = await boxOf(maintenanceCard(page));
    expect(location.y).toBeGreaterThan(info.y + info.height - 1);
    expect(Math.abs(maintenance.y - location.y)).toBeLessThanOrEqual(1);
    expect(location.x).toBeLessThan(maintenance.x);
    await expectNoHorizontalScroll(page);
  });
});

test.describe("the header controls", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("a writer sees the five controls in order, the three still to come disabled with Próximamente", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const controls = page.locator(".page-head .head-actions").getByRole("button");
    // Accessible names, not raw text: the menu toggle draws its glyphs in aria-hidden spans
    const names = [d.recordReading.trigger, t.comingSoon.newOr, t.comingSoon.newOt, t.comingSoon.unavailability, t.moreActions];
    await expect(controls).toHaveCount(names.length);
    for (const [index, name] of names.entries()) await expect(controls.nth(index), name).toHaveAccessibleName(name);
    for (const label of [t.comingSoon.newOr, t.comingSoon.newOt, t.comingSoon.unavailability]) {
      const button = controls.getByText(label, { exact: true });
      await expect(button, label).toBeDisabled();
      await expect(button, label).toHaveAttribute("title", t.soon);
      await expect(button, label).toHaveAccessibleDescription(t.soon);
    }
    await expect(recordButton(page)).toBeEnabled();
    await expect(moreToggle(page)).toBeEnabled();
  });
});

test.describe("the Más acciones menu", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("opens on the button, lists the actions, and closes with Escape or on choosing one", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const toggle = moreToggle(page);
    const edit = menuOf(page).getByRole("button", { name: d.editEquipment.trigger, exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(edit).toBeHidden();
    await expect(async () => {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass();
    for (const name of [d.replaceEquipment.trigger, d.endAssignment.trigger, d.editEquipment.trigger]) {
      await expect(menuOf(page).getByRole("button", { name, exact: true }), name).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(edit).toBeHidden();
    const dialog = await openDialog(page, d.editEquipment.trigger, menuOf(page));
    await expect(dialog.getByRole("heading", { name: d.editEquipment.title("CYC-OK") })).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await expect(openDialogOf(page)).toBeHidden();
  });

  test("closes on a click outside", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    await expect(async () => {
      await moreToggle(page).click();
      await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass();
    await page.getByRole("heading", { level: 1 }).click();
    await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("an unassigned equipment offers Asignar in the location card and the rest in the menu", async ({ page }) => {
    const seeder = await openSeeder();
    let id: string;
    try {
      const supplier = await seeder.supplier("Idle supplier");
      const type = await seeder.assetType("Idle type");
      id = await seeder.equipment({ supplierId: supplier, assetTypeId: type, internalCode: "CYC-IDLE" });
    } finally {
      await seeder.close();
    }
    await gotoDetail(page, id, "CYC-IDLE");
    await expect(locationCard(page).getByRole("button", { name: d.assignEquipment.trigger, exact: true })).toBeVisible();
    await expect(buttonNamed(page, d.moveEquipment.trigger)).toHaveCount(0);
    await expect(buttonNamed(page, d.editEquipment.trigger)).toHaveCount(1);
  });
});

for (const role of ["viewer", "manager", "supervisor"] as const) {
  test.describe(`header controls as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(resetCatalogs);

    test("shows the cards and the chart but none of the five controls", async ({ page }) => {
      const ids = await seedCycle();
      await gotoDetail(page, ids.ok, "CYC-OK");
      await expect(ringValue(page)).toHaveText("130 hs");
      await expect(usageCard(page).getByRole("img")).toBeVisible();
      await expect(page.locator(".page-head").getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("button", { name: t.comingSoon.newOr })).toHaveCount(0);
      await expect(recordButton(page)).toHaveCount(0);
      await expect(moreToggle(page)).toHaveCount(0);
      await expect(menuOf(page)).toHaveCount(0);
      await expect(locationCard(page).getByRole("button")).toHaveCount(0);
    });
  });
}

test.describe("header controls as an administrator", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("sees the five controls and the menu without Dar de baja", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    await expect(page.locator(".page-head .head-actions").getByRole("button")).toHaveCount(5);
    await expect(recordButton(page)).toBeVisible();
    await expect(buttonNamed(page, d.archive.trigger)).toHaveCount(0);
  });
});

test.describe("equipment detail cards on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("@mobile the four cards stack, the chart fits and the menu opens inside the screen", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    await expectNoHorizontalScroll(page);
    let bottom = 0;
    for (const card of [infoCard(page), locationCard(page), maintenanceCard(page), usageCard(page)]) {
      const box = await boxOf(card);
      expect(box.y, "each card sits below the previous one").toBeGreaterThanOrEqual(bottom - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
      bottom = box.y + box.height;
    }
    expect((await boxOf(usageCard(page).locator("svg"))).width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect((await boxOf(usageCard(page).getByLabel(u.period, { exact: true }))).x + (await boxOf(usageCard(page).getByLabel(u.period, { exact: true }))).width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    for (const button of await page.locator(".page-head .head-actions").getByRole("button").all()) {
      expect((await boxOf(button)).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
    await expect(async () => {
      await moreToggle(page).tap();
      await expect(moreToggle(page)).toHaveAttribute("aria-expanded", "true", { timeout: 1_000 });
    }).toPass();
    const panel = await boxOf(menuOf(page));
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    for (const button of await menuOf(page).getByRole("button").all()) {
      expect((await boxOf(button)).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    }
  });

  test("@mobile the way back is in the top bar", async ({ page }) => {
    const ids = await seedCycle();
    await gotoDetail(page, ids.ok, "CYC-OK");
    const back = page.locator(".topbar").getByRole("link", { name: t.back });
    await expect(back).toBeVisible();
    expect((await boxOf(back)).height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
  });
});
