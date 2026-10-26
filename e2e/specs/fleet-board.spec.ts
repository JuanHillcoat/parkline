import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs, type Seeder } from "../support/data";
import { changeArchiveState, gotoFleet, rowOf, tabLink } from "../support/fleet-flows";
import { EDGE_GAP_TOLERANCE, boxOf, cardCells, edgeGaps, expectNoHorizontalScroll, MIN_TEXT_SIZE } from "../support/mobile-flows";
import { readWorld, storageStatePath } from "../support/world";

const t = copy.fleet;
const WORLD_OPERATION = "OPERATION E2E";
const WORLD_SITE = "SITE E2E";
const SIBLING_OPERATION = "BOARD SIBLING OP";
const SIBLING_SITE = "BOARD SIBLING SITE";

type Board = { siblingOperationId: string };

/**
 * The board of these suites. The world's own operation sits in the world's division, so the scoped
 * users (manager over the division, supervisor over the operation) see:
 *   A-ACTIVE   in OPERATION E2E (world operation), active   (manager and supervisor)
 *   B-SPARE    a muleto of BOARD SIBLING SITE: no operation, no division (company-wide readers only, ADR-0013 D4)
 *   C-ELSEWHERE in another division, active                 (neither)
 *   D-IDLE     never assigned                               (neither; company-wide readers see it)
 *   E-SIBLING  in BOARD SIBLING OP (same division), active  (manager only)
 */
async function seedBoard(): Promise<Board> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const north = await seeder.supplier("Norte rental");
    const south = await seeder.supplier("Sur rental");
    const forklift = await seeder.assetType("Forklift");
    const crane = await seeder.assetType("Crane");
    const siblingSite = await seeder.site(SIBLING_SITE);
    const siblingOperationId = await seeder.operation({ division: world.division, site: siblingSite, name: SIBLING_OPERATION, costCenter: "7101" });
    const otherDivision = await seeder.division("Board other division");
    const otherSite = await seeder.site("Board other site");
    const otherOperation = await seeder.operation({ division: otherDivision, site: otherSite, name: "Board other op", costCenter: "7102" });
    const unit = (internalCode: string, supplierId: string, assetTypeId: string) =>
      seeder.equipment({ supplierId, assetTypeId, internalCode });
    await seeder.assign({ equipmentId: await unit("A-ACTIVE", north, forklift), operationId: world.operation });
    await seeder.assignSpare({ equipmentId: await unit("B-SPARE", south, crane), siteId: siblingSite });
    await seeder.assign({ equipmentId: await unit("E-SIBLING", south, crane), operationId: siblingOperationId });
    await seeder.assign({ equipmentId: await unit("C-ELSEWHERE", north, crane), operationId: otherOperation });
    await unit("D-IDLE", south, forklift);
    return { siblingOperationId };
  } finally {
    await seeder.close();
  }
}

const expectRows = async (page: Page, present: readonly string[], absent: readonly string[]): Promise<void> => {
  for (const code of present) await expect(rowOf(page, code), `${code} is listed`).toHaveCount(1);
  for (const code of absent) await expect(rowOf(page, code), `${code} is not listed`).toHaveCount(0);
};

const optionTexts = (page: Page, label: string) => page.getByRole("search").getByLabel(label, { exact: true }).locator("option");

test.describe("fleet board as a fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("shows the Estado pill for active, spare and unassigned equipment", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(rowOf(page, "A-ACTIVE").getByText(t.state.active, { exact: true })).toBeVisible();
    await expect(rowOf(page, "B-SPARE").getByText(t.state.spare, { exact: true })).toBeVisible();
    await expect(rowOf(page, "C-ELSEWHERE").getByText(t.state.active, { exact: true })).toBeVisible();
    await expect(rowOf(page, "D-IDLE").getByText(t.state.unassigned, { exact: true })).toBeVisible();
  });

  test("shows the operation and the site of each equipment, and a dash when it has none", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(page.getByRole("columnheader", { name: t.columns.operation })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: t.columns.site })).toBeVisible();
    const active = rowOf(page, "A-ACTIVE");
    await expect(active.locator(`td[data-label="${t.columns.operation}"]`)).toHaveText(WORLD_OPERATION);
    await expect(active.locator(`td[data-label="${t.columns.site}"]`)).toHaveText(WORLD_SITE);
    const spare = rowOf(page, "B-SPARE");
    await expect(spare.locator(`td[data-label="${t.columns.operation}"]`)).toHaveText(t.noValue);
    await expect(spare.locator(`td[data-label="${t.columns.site}"]`)).toHaveText(SIBLING_SITE);
    const sibling = rowOf(page, "E-SIBLING");
    await expect(sibling.locator(`td[data-label="${t.columns.operation}"]`)).toHaveText(SIBLING_OPERATION);
    await expect(sibling.locator(`td[data-label="${t.columns.site}"]`)).toHaveText(SIBLING_SITE);
    const idle = rowOf(page, "D-IDLE");
    await expect(idle.locator(`td[data-label="${t.columns.operation}"]`)).toHaveText(t.noValue);
    await expect(idle.locator(`td[data-label="${t.columns.site}"]`)).toHaveText(t.noValue);
  });

  test("keeps the De baja pill on archived equipment instead of the assignment state", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await changeArchiveState(page, "D-IDLE", "archive", "Returned to the supplier");
    await gotoFleet(page, "equipment", "archived=1");
    const archived = rowOf(page, "D-IDLE");
    await expect(archived.getByText(copy.common.archivedTag, { exact: true })).toBeVisible();
    await expect(archived.getByText(t.state.unassigned, { exact: true })).toHaveCount(0);
  });

  test("a state filter never matches archived equipment, whose pill is De baja", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await changeArchiveState(page, "D-IDLE", "archive", "Returned to the supplier");
    await gotoFleet(page, "equipment", "archived=1");
    await expect(rowOf(page, "D-IDLE")).toBeVisible();
    await gotoFleet(page, "equipment", "archived=1&state=unassigned");
    await expect(rowOf(page, "D-IDLE")).toHaveCount(0);
  });

  test("filters by operation from the toolbar", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await page.getByRole("search").getByLabel(t.operationFilter, { exact: true }).selectOption({ label: SIBLING_OPERATION });
    await page.getByRole("button", { name: t.applyFilters }).click();
    await expect(page).toHaveURL(/operation=/u);
    // A muleto belongs to a site, not to an operation: the operation filter never matches it.
    await expectRows(page, ["E-SIBLING"], ["A-ACTIVE", "B-SPARE", "C-ELSEWHERE", "D-IDLE"]);
    await expect(page.getByRole("search").getByLabel(t.operationFilter, { exact: true })).toHaveValue(/.+/u);
  });

  test("filters by state from the toolbar", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await page.getByLabel(t.stateFilter, { exact: true }).selectOption({ label: t.state.unassigned });
    await page.getByRole("button", { name: t.applyFilters }).click();
    await expectRows(page, ["D-IDLE"], ["A-ACTIVE", "B-SPARE", "C-ELSEWHERE", "E-SIBLING"]);
    await gotoFleet(page, "equipment", "state=spare");
    await expectRows(page, ["B-SPARE"], ["A-ACTIVE", "C-ELSEWHERE", "D-IDLE", "E-SIBLING"]);
    await gotoFleet(page, "equipment", "state=active");
    await expectRows(page, ["A-ACTIVE", "C-ELSEWHERE", "E-SIBLING"], ["B-SPARE", "D-IDLE"]);
  });

  test("combines the state, operation and search filters, and offers a way to clear them", async ({ page }) => {
    const board = await seedBoard();
    await gotoFleet(page, "equipment", "state=spare&q=spare");
    await expectRows(page, ["B-SPARE"], ["A-ACTIVE", "C-ELSEWHERE", "D-IDLE", "E-SIBLING"]);
    await gotoFleet(page, "equipment", `state=spare&operation=${board.siblingOperationId}`);
    await expect(page.getByText(t.noResults)).toBeVisible();
    await gotoFleet(page, "equipment", `state=active&operation=${board.siblingOperationId}&q=sibling`);
    await expectRows(page, ["E-SIBLING"], ["A-ACTIVE", "B-SPARE", "C-ELSEWHERE", "D-IDLE"]);
    await page.getByRole("link", { name: t.clearFilters }).click();
    await expectRows(page, ["A-ACTIVE", "B-SPARE", "C-ELSEWHERE", "D-IDLE", "E-SIBLING"], []);
  });

  test("ignores an unknown state or operation instead of failing", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page, "equipment", "state=bogus&operation=not-an-operation");
    await expectRows(page, ["A-ACTIVE", "B-SPARE", "C-ELSEWHERE", "D-IDLE", "E-SIBLING"], []);
  });

  test("keeps the state filter across pages", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      await seedSpares(seeder, 21);
    } finally {
      await seeder.close();
    }
    await gotoFleet(page, "equipment", "state=spare");
    await expect(page.getByText(t.showing(1, 20, 21))).toBeVisible();
    const next = page.getByRole("link", { name: t.nextPage });
    await expect(next).toHaveAttribute("href", /state=spare/u);
    await next.click();
    await expect(page).toHaveURL(/state=spare/u);
    await expect(page).toHaveURL(/page=2/u);
    await expect(page.getByText(t.showing(21, 21, 21))).toBeVisible();
  });

  test("keeps every tab for a company-wide reader", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(tabLink(page, "suppliers")).toBeVisible();
    await expect(tabLink(page, "asset-types")).toBeVisible();
  });
});

/** `count` spare units of one supplier at the world's site (a muleto belongs to a site). */
async function seedSpares(seeder: Seeder, count: number): Promise<void> {
  const supplier = await seeder.supplier("Many rental");
  const assetType = await seeder.assetType("Many type");
  for (let index = 1; index <= count; index += 1) {
    const equipmentId = await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: `S-${String(index).padStart(3, "0")}` });
    await seeder.assignSpare({ equipmentId, siteId: readWorld().ids.site });
  }
}

test.describe("fleet board: company-wide readers see equipment without an assignment", () => {
  test.beforeEach(resetCatalogs);
  for (const role of ["admin", "viewer", "fleet_analyst"] as const) {
    test.describe(role, () => {
      test.use({ storageState: storageStatePath(role) });

      test("lists the five units, the muleto, the unassigned and the other division's one included", async ({ page }) => {
        await seedBoard();
        await gotoFleet(page);
        await expectRows(page, ["A-ACTIVE", "B-SPARE", "C-ELSEWHERE", "D-IDLE", "E-SIBLING"], []);
      });
    });
  }
});

test.describe("fleet board as a manager scoped to a division", () => {
  test.use({ storageState: storageStatePath("manager") });
  test.beforeEach(resetCatalogs);

  test("sees only the equipment assigned inside its division, with supplier and asset type names", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    // The muleto of the site (B-SPARE) has no division: a division manager does not see it (ADR-0013 D4).
    await expectRows(page, ["A-ACTIVE", "E-SIBLING"], ["B-SPARE", "C-ELSEWHERE", "D-IDLE"]);
    await expect(rowOf(page, "A-ACTIVE").locator(`td[data-label="${t.columns.supplier}"]`)).toHaveText("NORTE RENTAL");
    await expect(rowOf(page, "A-ACTIVE").locator(`td[data-label="${t.columns.assetType}"]`)).toHaveText("FORKLIFT");
    await expect(rowOf(page, "E-SIBLING").locator(`td[data-label="${t.columns.supplier}"]`)).toHaveText("SUR RENTAL");
    await expect(rowOf(page, "E-SIBLING").locator(`td[data-label="${t.columns.assetType}"]`)).toHaveText("CRANE");
    await expect(rowOf(page, "E-SIBLING").getByText(t.state.active, { exact: true })).toBeVisible();
  });

  test("sees no Proveedores or Tipos de equipo tabs, and the tab parameter falls back to equipment", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(page.getByRole("navigation", { name: t.tabsLabel })).toHaveCount(0);
    for (const tab of ["suppliers", "asset-types"] as const) {
      await page.goto(`/fleet?tab=${tab}`);
      await expect(page.getByRole("heading", { level: 1, name: t.title })).toBeVisible();
      await expect(page.getByRole("table", { name: t.equipmentCaption })).toBeVisible();
      await expect(page.getByRole("table", { name: t.suppliersCaption })).toHaveCount(0);
      await expect(page.getByRole("table", { name: t.assetTypesCaption })).toHaveCount(0);
    }
  });

  test("builds the supplier and type filters from the visible equipment only", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(optionTexts(page, t.supplierFilter)).toHaveText([t.allSuppliers, "NORTE RENTAL", "SUR RENTAL"]);
    await expect(optionTexts(page, t.typeFilter)).toHaveText([t.allTypes, "CRANE", "FORKLIFT"]);
    await expect(optionTexts(page, t.operationFilter)).toHaveText([t.allOperations, SIBLING_OPERATION, WORLD_OPERATION]);
    await gotoFleet(page, "equipment", "supplier=" + "00000000-0000-4000-8000-000000000000");
    await expectRows(page, ["A-ACTIVE", "E-SIBLING"], []);
  });

  test("has no create, edit or archive controls", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(page.getByRole("button", { name: copy.dialogs.newEquipment.trigger })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.dialogs.editEquipment.trigger })).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.dialogs.archive.trigger })).toHaveCount(0);
  });
});

test.describe("fleet board as a supervisor scoped to an operation", () => {
  test.use({ storageState: storageStatePath("supervisor") });
  test.beforeEach(resetCatalogs);

  test("sees only the equipment of its operation: another operation of its division is not visible", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expectRows(page, ["A-ACTIVE"], ["B-SPARE", "C-ELSEWHERE", "D-IDLE", "E-SIBLING"]);
    await expect(rowOf(page, "A-ACTIVE").locator(`td[data-label="${t.columns.supplier}"]`)).toHaveText("NORTE RENTAL");
    await expect(rowOf(page, "A-ACTIVE").locator(`td[data-label="${t.columns.assetType}"]`)).toHaveText("FORKLIFT");
    await expect(rowOf(page, "A-ACTIVE").locator(`td[data-label="${t.columns.operation}"]`)).toHaveText(WORLD_OPERATION);
  });

  test("sees no catalog tabs and a filter built from what it sees", async ({ page }) => {
    await seedBoard();
    await gotoFleet(page);
    await expect(page.getByRole("navigation", { name: t.tabsLabel })).toHaveCount(0);
    await expect(optionTexts(page, t.supplierFilter)).toHaveText([t.allSuppliers, "NORTE RENTAL"]);
    await expect(optionTexts(page, t.operationFilter)).toHaveText([t.allOperations, WORLD_OPERATION]);
  });

  test("an equipment without an assignment is invisible to it, and the scoped empty message shows", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      const supplier = await seeder.supplier("Idle rental");
      const assetType = await seeder.assetType("Idle type");
      await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: "IDLE-1" });
    } finally {
      await seeder.close();
    }
    await gotoFleet(page);
    await expect(page.getByText("IDLE-1")).toHaveCount(0);
    await expect(page.getByText(t.emptyScoped)).toBeVisible();
    await expect(page.getByText(t.emptyEquipment)).toHaveCount(0);
  });
});

test.describe("fleet board on a phone", () => {
  test.beforeEach(resetCatalogs);

  test.describe("fleet analyst", () => {
    test.use({ storageState: storageStatePath("fleet_analyst") });

    test("@mobile each equipment is a card with the operation, site and state labelled", async ({ page }) => {
      await seedBoard();
      await gotoFleet(page);
      await expectNoHorizontalScroll(page);
      const row = rowOf(page, "A-ACTIVE");
      const cells = await cardCells(row);
      const labelled = new Map(cells.map((cell) => [cell.label, cell]));
      for (const label of [t.columns.operation, t.columns.site, t.columns.status]) {
        const cell = labelled.get(label);
        expect(cell, `${label} cell`).toBeDefined();
        expect(cell?.shownLabel).toContain(label);
        expect(cell?.labelSize).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
        expect(cell?.valueSize).toBeGreaterThanOrEqual(MIN_TEXT_SIZE);
      }
      await expect(row.locator(`td[data-label="${t.columns.operation}"]`)).toHaveText(WORLD_OPERATION);
      const second = await boxOf(rowOf(page, "B-SPARE"));
      expect(second.y, "cards are stacked").toBeGreaterThan((await boxOf(row)).y);
    });

    test("@mobile the operation and state filters stack to full width", async ({ page }) => {
      await seedBoard();
      await gotoFleet(page);
      const form = page.getByRole("search");
      for (const label of [t.operationFilter, t.stateFilter]) {
        const gaps = await edgeGaps(form.getByLabel(label, { exact: true }), form);
        expect(gaps.left).toBeLessThanOrEqual(EDGE_GAP_TOLERANCE);
        expect(gaps.right).toBeLessThanOrEqual(EDGE_GAP_TOLERANCE);
      }
    });
  });

  test.describe("supervisor", () => {
    test.use({ storageState: storageStatePath("supervisor") });

    test("@mobile a scoped reader gets cards with supplier and type names and no tab strip", async ({ page }) => {
      await seedBoard();
      await gotoFleet(page);
      await expectNoHorizontalScroll(page);
      await expect(page.getByRole("navigation", { name: t.tabsLabel })).toHaveCount(0);
      const row = rowOf(page, "A-ACTIVE");
      await expect(row.locator(`td[data-label="${t.columns.supplier}"]`)).toHaveText("NORTE RENTAL");
      await expect(row.locator(`td[data-label="${t.columns.assetType}"]`)).toHaveText("FORKLIFT");
      await expect(rowOf(page, "B-SPARE")).toHaveCount(0);
    });
  });
});
