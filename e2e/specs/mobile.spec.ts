import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  MIN_TAP_TARGET,
  MIN_TEXT_SIZE,
  VIEWPORT_HEIGHT,
  VIEWPORT_WIDTH,
  actionHeights,
  boxOf,
  canTakeFocus,
  cardCells,
  cardLayout,
  drawerLinks,
  drawerOf,
  edgeGaps,
  expectNoHorizontalScroll,
  menuButton,
  openDrawer,
  EDGE_GAP_TOLERANCE,
} from "../support/mobile-flows";
import { WORLD_USERS, storageStatePath } from "../support/world";

/**
 * Mobile view: 400x608 with touch (the `mobile` project runs only tests tagged @mobile).
 * Layout rules live in app/globals.css (max-width 900px: drawer; 640px: stacked cards).
 * The suite only reads and opens dialogs, so one seeding for the whole file is enough.
 */
const SUPPLIERS = ["Mobile Alpha", "Mobile Beta", "Mobile Gamma"];

test.beforeAll(async () => {
  await resetCatalogs();
  const seeder = await openSeeder();
  try {
    const supplierIds = await Promise.all(SUPPLIERS.map((name) => seeder.supplier(name)));
    const hours = await seeder.assetType("Mobile Crane", "hours", 250);
    const km = await seeder.assetType("Mobile Truck", "km");
    const [first, second] = supplierIds;
    if (first === undefined || second === undefined) throw new Error("Suppliers were not seeded");
    await seeder.equipment({ supplierId: first, assetTypeId: hours, internalCode: "M-001", brand: "Brand", model: "X1", year: 2020 });
    await seeder.equipment({ supplierId: second, assetTypeId: km, internalCode: "M-002" });
    const division = await seeder.division("Mobile Division");
    const site = await seeder.site("Mobile Site");
    await seeder.operation({ division, site, name: "Mobile Operation", costCenter: "7001" });
  } finally {
    await seeder.close();
  }
});

test.afterAll(resetCatalogs);

async function expectCardRules(row: Locator): Promise<void> {
  for (const cell of await cardCells(row)) {
    expect(cell.shownLabel, "each value shows its column label").toBe(`"${cell.label}"`);
    expect(cell.labelSize).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
    expect(cell.valueSize).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
  }
  const { others, actions } = await cardLayout(row);
  for (const box of others) expect(actions.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  for (const height of await actionHeights(row)) expect(height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
}

/** One table rendered as cards: caption for assistive tech, hidden header, one card per row. */
async function expectStackedCards(page: Page, caption: string): Promise<void> {
  const table = page.locator("table").filter({ has: page.locator("caption", { hasText: caption }) });
  await expect(table.locator("caption")).toHaveText(caption);
  const head = await boxOf(table.locator("thead"));
  expect(head.width, "the column header is hidden visually").toBeLessThanOrEqual(1);
  const rows = await table.locator("tbody tr").all();
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) await expectCardRules(row);
  const [first, second] = rows;
  if (first !== undefined && second !== undefined) {
    expect((await boxOf(second)).y, "cards are stacked, one per row").toBeGreaterThan((await boxOf(first)).y);
  }
}

test.describe("fleet analyst on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });

  test.describe("page width", () => {
    const pages = ["/", "/fleet", "/fleet?tab=suppliers", "/fleet?tab=asset-types", "/organization"];
    for (const path of pages) {
      test(`@mobile ${path} does not scroll horizontally`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoHorizontalScroll(page);
      });
    }
  });

  test.describe("navigation drawer", () => {
    test("@mobile the sidebar is hidden and unfocusable until the menu button opens it", async ({ page }) => {
      await page.goto("/");
      await expect(drawerOf(page)).toBeHidden();
      const fleetLink = drawerOf(page).getByRole("link", { name: copy.nav.fleet, includeHidden: true });
      expect(await canTakeFocus(fleetLink)).toBe(false);
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
      await expect(menuButton(page)).toHaveAttribute("aria-controls", "app-sidebar");
      await openDrawer(page);
      expect(await canTakeFocus(drawerLinks(page).first())).toBe(true);
    });

    test("@mobile shows the entries the analyst may open", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      await expect(drawerLinks(page)).toHaveText([copy.nav.home, copy.nav.fleet, copy.nav.organization]);
    });

    test("@mobile closes with the close button and returns focus to the menu button", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      await page.getByRole("button", { name: copy.nav.closeMenu }).tap();
      await expect(drawerOf(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    });

    test("@mobile closes with Escape", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      await page.keyboard.press("Escape");
      await expect(drawerOf(page)).toBeHidden();
      await expect(menuButton(page)).toBeFocused();
    });

    test("@mobile closes when the scrim is tapped", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      // The drawer is at most 288px wide; tap the dimmed area to its right.
      await page.touchscreen.tap(VIEWPORT_WIDTH - 20, VIEWPORT_HEIGHT / 2);
      await expect(drawerOf(page)).toBeHidden();
    });

    test("@mobile closes after navigating through a link", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      await drawerLinks(page).filter({ hasText: copy.nav.organization }).tap();
      await expect(page).toHaveURL(/\/organization$/);
      await expect(drawerOf(page)).toBeHidden();
    });

    // P0-10 defect: the same pathname with another query string left the drawer open.
    test("@mobile closes after tapping the link to the page that is already open", async ({ page }) => {
      await page.goto("/fleet?tab=suppliers");
      await openDrawer(page);
      await drawerLinks(page).filter({ hasText: copy.nav.fleet }).tap();
      await expect(page).toHaveURL(/\/fleet$/);
      await expect(drawerOf(page)).toBeHidden();
      await expect(menuButton(page)).toHaveAttribute("aria-expanded", "false");
    });
  });

  test.describe("fleet", () => {
    test("@mobile tabs stay on one line inside a horizontally scrollable strip", async ({ page }) => {
      await page.goto("/fleet");
      const tabs = page.getByRole("navigation", { name: copy.fleet.tabsLabel });
      const links = await tabs.getByRole("link").all();
      expect(links).toHaveLength(3);
      const tops = await Promise.all(links.map(async (link) => Math.round((await boxOf(link)).y)));
      expect(new Set(tops).size).toBe(1);
      expect(await tabs.evaluate((nav) => getComputedStyle(nav).overflowX)).toBe("auto");
    });

    test("@mobile equipment rows are stacked cards", async ({ page }) => {
      await page.goto("/fleet");
      await expectStackedCards(page, copy.fleet.equipmentCaption);
    });

    test("@mobile supplier rows are stacked cards", async ({ page }) => {
      await page.goto("/fleet?tab=suppliers");
      await expectStackedCards(page, copy.fleet.suppliersCaption);
    });

    test("@mobile asset type rows are stacked cards", async ({ page }) => {
      await page.goto("/fleet?tab=asset-types");
      await expectStackedCards(page, copy.fleet.assetTypesCaption);
    });

    test("@mobile filters stack to full width and the actions fill the row", async ({ page }) => {
      await page.goto("/fleet?q=M-001");
      const form = page.getByRole("search");
      const fields = [copy.fleet.searchLabel, copy.fleet.supplierFilter, copy.fleet.typeFilter].map((label) => form.getByLabel(label));
      for (const field of fields) {
        const gaps = await edgeGaps(field, form);
        expect(gaps.left).toBeLessThanOrEqual(EDGE_GAP_TOLERANCE);
        expect(gaps.right).toBeLessThanOrEqual(EDGE_GAP_TOLERANCE);
      }
      const apply = page.getByRole("button", { name: copy.fleet.applyFilters });
      const clear = page.getByRole("link", { name: copy.fleet.clearFilters });
      expect((await edgeGaps(apply, form)).left).toBeLessThanOrEqual(EDGE_GAP_TOLERANCE);
      expect((await edgeGaps(clear, form)).right).toBeLessThanOrEqual(EDGE_GAP_TOLERANCE);
      expect((await boxOf(apply)).width).toBeGreaterThan(VIEWPORT_WIDTH / 3);
      expect((await boxOf(clear)).width).toBeGreaterThan(VIEWPORT_WIDTH / 3);
    });
  });

  test.describe("organization", () => {
    test("@mobile operation and site rows are stacked cards", async ({ page }) => {
      await page.goto("/organization");
      await expectStackedCards(page, copy.organization.divisionsCaption("MOBILE DIVISION"));
      await expectStackedCards(page, copy.organization.sitesCaption);
    });

    test("@mobile the header actions wrap with the primary button first and full width", async ({ page }) => {
      await page.goto("/organization");
      const first = page.getByRole("button", { name: copy.dialogs.newDivision.trigger });
      const second = page.getByRole("button", { name: copy.dialogs.newSite.trigger });
      const [a, b] = [await boxOf(first), await boxOf(second)];
      expect(a.y).toBeLessThan(b.y);
      expect(a.width).toBeGreaterThan(VIEWPORT_WIDTH - 64);
      expect(b.height).toBeGreaterThanOrEqual(MIN_TAP_TARGET);
    });
  });

  test.describe("dialogs", () => {
    async function openNewEquipment(page: Page): Promise<Locator> {
      await page.goto("/fleet");
      await page.getByRole("button", { name: copy.dialogs.newEquipment.trigger }).tap();
      const dialog = page.getByRole("dialog", { name: copy.dialogs.newEquipment.title });
      await expect(dialog).toBeVisible();
      return dialog;
    }

    test("@mobile a dialog fits the viewport", async ({ page }) => {
      const box = await boxOf(await openNewEquipment(page));
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    });

    test("@mobile the footer buttons are full width, stacked and reachable", async ({ page }) => {
      const dialog = await openNewEquipment(page);
      const submit = dialog.getByRole("button", { name: copy.dialogs.newEquipment.submit });
      const cancel = dialog.getByRole("button", { name: copy.common.cancel });
      await submit.scrollIntoViewIfNeeded();
      const [s, c] = [await boxOf(submit), await boxOf(cancel)];
      expect(s.width).toBeGreaterThan(VIEWPORT_WIDTH - 100);
      expect(s.y + s.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
      expect(c.y, "the primary action comes first on a phone").toBeGreaterThan(s.y);
      await cancel.scrollIntoViewIfNeeded();
      await cancel.tap();
      await expect(dialog).toBeHidden();
    });
  });
});

test.describe("administrator on a phone", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("@mobile /users does not scroll horizontally", async ({ page }) => {
    await page.goto("/users");
    await expect(page.getByRole("heading", { level: 1, name: copy.users.title })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("@mobile user rows are stacked cards", async ({ page }) => {
    await page.goto("/users");
    await expectStackedCards(page, copy.users.tableCaption);
  });

  test("@mobile the drawer lists every entry", async ({ page }) => {
    await page.goto("/");
    await openDrawer(page);
    await expect(drawerLinks(page)).toHaveText([copy.nav.home, copy.nav.fleet, copy.nav.users, copy.nav.organization]);
  });
});

test.describe("scoped roles on a phone", () => {
  test.describe("supervisor", () => {
    test.use({ storageState: storageStatePath("supervisor") });

    test("@mobile the drawer lists only the entries the role may open", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      // Flota is open to scoped readers since P0-08 T4 (equipment is visible by its assignment, D6).
      await expect(drawerLinks(page)).toHaveText([copy.nav.home, copy.nav.fleet, copy.nav.organization]);
    });
  });

  test.describe("viewer", () => {
    test.use({ storageState: storageStatePath("viewer") });

    test("@mobile the drawer has no users entry and cards have no action buttons", async ({ page }) => {
      await page.goto("/");
      await openDrawer(page);
      await expect(drawerLinks(page)).toHaveText([copy.nav.home, copy.nav.fleet, copy.nav.organization]);
      await page.goto("/fleet?tab=suppliers");
      const row = page.locator("tbody tr").first();
      await expect(row).toBeVisible();
      await expect(row.getByRole("button")).toHaveCount(0);
    });

    test("@mobile dashboard cards reflow to one column and stay readable", async ({ page }) => {
      await page.goto("/");
      const name = WORLD_USERS.viewer.displayName;
      await expect(page.getByRole("heading", { level: 1, name: copy.home.greeting(name) })).toBeVisible();
      const cards = await page.getByRole("link", { name: /Ver / }).all();
      expect(cards.length).toBeGreaterThanOrEqual(3);
      const boxes = await Promise.all(cards.map((card) => boxOf(card)));
      const [first, second] = boxes;
      expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);
      expect(new Set(boxes.map((box) => Math.round(box.x))).size).toBe(1);
      await expectNoHorizontalScroll(page);
      const sizes = await page
        .locator(".kpi-label, .kpi-value")
        .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
    });
  });
});
