import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs, type Seeder } from "../support/data";
import { setArchived, setWorldOrganizationArchived } from "../support/users-flows";
import { WORLD_USERS, readWorld, storageStatePath } from "../support/world";

const t = copy.home;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const kpiCard = (page: Page, label: string): Locator =>
  page.getByRole("link", { name: new RegExp(`^${escapeRegExp(label)}: \\d+\\.`) });

const expectKpi = async (page: Page, label: keyof typeof t.kpi, count: number, href: string): Promise<void> => {
  const card = page.getByRole("link", { name: `${t.kpi[label]}: ${String(count)}. ${t.kpiLink(t.kpi[label])}` });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", href);
};

const distributionCard = (page: Page, title: string): Locator =>
  page.getByRole("region", { name: title });

/** Seeds `counts[i]` pieces of equipment for supplier `S{i+1}`, all of one asset type. */
async function seedEquipmentBySupplier(seeder: Seeder, counts: readonly number[]) {
  const assetType = await seeder.assetType("Camion");
  const suppliers: string[] = [];
  for (const [index, count] of counts.entries()) {
    const supplier = await seeder.supplier(`Proveedor ${String(index + 1)}`);
    suppliers.push(supplier);
    for (let unit = 1; unit <= count; unit += 1) {
      await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: `P${String(index + 1)}-${String(unit)}` });
    }
  }
  return { assetType, suppliers };
}

test.describe("dashboard of an anonymous visitor", () => {
  test("redirects to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("dashboard with nothing registered", () => {
  test.use({ storageState: storageStatePath("admin") });
  // The world keeps one division, site and operation for the scoped users; archiving them (only
  // here, restored afterwards) is how a company with nothing registered looks.
  test.beforeAll(async () => {
    await resetCatalogs();
    await setWorldOrganizationArchived(true);
  });
  test.afterAll(async () => {
    await setWorldOrganizationArchived(false);
  });

  test("greets the user by display name", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: t.greeting(WORLD_USERS.admin.displayName) })).toBeVisible();
    await expect(page.getByText(t.subtitle)).toBeVisible();
  });

  test("shows every card at zero", async ({ page }) => {
    await page.goto("/");
    for (const label of ["equipment", "suppliers", "assetTypes", "divisions", "operations", "sites"] as const) {
      await expectKpi(page, label, 0, label.match(/equipment|suppliers|assetTypes/) ? "/fleet" : "/organization");
    }
  });

  test("shows the first steps linking to organization and fleet", async ({ page }) => {
    await page.goto("/");
    const steps = page.getByRole("region", { name: t.firstSteps.title });
    await expect(steps).toBeVisible();
    await expect(steps.getByRole("link", { name: t.firstSteps.organization.cta })).toHaveAttribute("href", "/organization");
    await expect(steps.getByRole("link", { name: t.firstSteps.fleet.cta })).toHaveAttribute("href", "/fleet");
    await expect(steps.getByText(t.firstSteps.stepLabel(1))).toBeVisible();
    await expect(steps.getByText(t.firstSteps.stepLabel(2))).toBeVisible();
  });

  test("shows no distribution bars, only an invitation to load equipment", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    for (const title of [t.distribution.byAssetType, t.distribution.bySupplier]) {
      const card = distributionCard(page, title);
      await expect(card.getByText(t.distribution.emptyTitle)).toBeVisible();
      await expect(card.getByRole("link", { name: t.distribution.emptyCta })).toHaveAttribute("href", "/fleet");
    }
  });

  test("hides the first steps as soon as something is registered", async ({ page }) => {
    await resetCatalogs();
    const seeder = await openSeeder();
    try {
      await seeder.supplier("Primer proveedor");
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    await expectKpi(page, "suppliers", 1, "/fleet");
    await expect(page.getByRole("region", { name: t.firstSteps.title })).toHaveCount(0);
  });
});

test.describe("dashboard with data", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("counts each catalog and links the card to its section", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      const { suppliers } = await seedEquipmentBySupplier(seeder, [2, 1]);
      expect(suppliers).toHaveLength(2);
      await seeder.assetType("Grua");
      const division = await seeder.division("Norte");
      const site = await seeder.site("Sitio uno");
      await seeder.operation({ division, site, name: "Planta", costCenter: "1001" });
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    await expectKpi(page, "equipment", 3, "/fleet");
    await expectKpi(page, "suppliers", 2, "/fleet");
    await expectKpi(page, "assetTypes", 2, "/fleet");
    // The world's own division, site and operation are counted as well.
    await expectKpi(page, "divisions", 2, "/organization");
    await expectKpi(page, "operations", 2, "/organization");
    await expectKpi(page, "sites", 2, "/organization");
    await expect(page.getByRole("region", { name: t.firstSteps.title })).toHaveCount(0);
  });

  test("a card navigates to the section it points to", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      await seeder.supplier("Uno");
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    await kpiCard(page, t.kpi.divisions).click();
    await expect(page).toHaveURL(/\/organization$/);
  });

  test("counts only active rows: archived ones drop out of every card", async ({ page }) => {
    const seeder = await openSeeder();
    let archived: { equipment: string; supplier: string; assetType: string; division: string; site: string; operation: string };
    try {
      const supplier = await seeder.supplier("Activo");
      const spare = await seeder.supplier("Para baja");
      const assetType = await seeder.assetType("Tipo activo");
      const spareType = await seeder.assetType("Tipo para baja");
      await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: "A-1" });
      const equipment = await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: "A-2" });
      const division = await seeder.division("Division baja");
      const site = await seeder.site("Sitio baja");
      const operation = await seeder.operation({ division, site, name: "Operacion baja", costCenter: "1002" });
      archived = { equipment, supplier: spare, assetType: spareType, division, site, operation };
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    await expectKpi(page, "equipment", 2, "/fleet");
    await expectKpi(page, "suppliers", 2, "/fleet");
    await expectKpi(page, "assetTypes", 2, "/fleet");
    await expectKpi(page, "divisions", 2, "/organization");

    await setArchived("equipments", [archived.equipment], true);
    await setArchived("suppliers", [archived.supplier], true);
    await setArchived("asset_types", [archived.assetType], true);
    await setArchived("operations", [archived.operation], true);
    await setArchived("sites", [archived.site], true);
    await setArchived("business_units", [archived.division], true);
    await page.reload();
    await expectKpi(page, "equipment", 1, "/fleet");
    await expectKpi(page, "suppliers", 1, "/fleet");
    await expectKpi(page, "assetTypes", 1, "/fleet");
    await expectKpi(page, "divisions", 1, "/organization");
    await expectKpi(page, "operations", 1, "/organization");
    await expectKpi(page, "sites", 1, "/organization");
  });
});

test.describe("equipment distributions", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("list each group with its count and percentage, exposed as accessible bars", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      await seedEquipmentBySupplier(seeder, [3, 1]);
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    const card = distributionCard(page, t.distribution.bySupplier);
    await expect(card.getByText(t.distribution.total(4))).toBeVisible();
    const big = card.getByRole("progressbar", { name: t.distribution.row("PROVEEDOR 1", 3, 75) });
    await expect(big).toHaveAttribute("value", "75");
    await expect(card.getByRole("progressbar", { name: t.distribution.row("PROVEEDOR 2", 1, 25) })).toHaveAttribute("value", "25");
    await expect(card.getByText("3 (75 %)")).toBeVisible();
    const byType = distributionCard(page, t.distribution.byAssetType);
    await expect(byType.getByRole("progressbar", { name: t.distribution.row("CAMION", 4, 100) })).toBeVisible();
  });

  test("keep the top five groups and fold the rest into 'Otros'", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      await seedEquipmentBySupplier(seeder, [7, 6, 5, 4, 3, 2, 1]);
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    const card = distributionCard(page, t.distribution.bySupplier);
    await expect(card.getByText(t.distribution.total(28))).toBeVisible();
    const bars = card.getByRole("progressbar");
    await expect(bars).toHaveCount(6);
    await expect(card.getByRole("progressbar", { name: new RegExp("^PROVEEDOR 1: 7 ") })).toBeVisible();
    await expect(card.getByRole("progressbar", { name: new RegExp("^PROVEEDOR 5: 3 ") })).toBeVisible();
    await expect(card.getByRole("progressbar", { name: new RegExp("^PROVEEDOR 6") })).toHaveCount(0);
    await expect(card.getByRole("progressbar", { name: new RegExp(`^${t.distribution.others}: 3 `) })).toBeVisible();
    const values = await bars.evaluateAll((all) => all.map((bar) => (bar as HTMLProgressElement).value));
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  test("count equipment of an archived supplier as 'Otros' and keep it in the total", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      const { suppliers } = await seedEquipmentBySupplier(seeder, [2, 1]);
      await setArchived("suppliers", [suppliers[1] ?? ""], true);
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    const card = distributionCard(page, t.distribution.bySupplier);
    await expect(card.getByText(t.distribution.total(3))).toBeVisible();
    await expect(card.getByRole("progressbar", { name: t.distribution.row("PROVEEDOR 1", 2, 67) })).toBeVisible();
    await expect(card.getByRole("progressbar", { name: t.distribution.row(t.distribution.others, 1, 33) })).toBeVisible();
    await expectKpi(page, "suppliers", 1, "/fleet");
  });

  test("count equipment of an archived asset type as 'Otros' in the type distribution", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      const { assetType } = await seedEquipmentBySupplier(seeder, [2]);
      await setArchived("asset_types", [assetType], true);
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    const card = distributionCard(page, t.distribution.byAssetType);
    await expect(card.getByRole("progressbar")).toHaveCount(1);
    await expect(card.getByRole("progressbar", { name: t.distribution.row(t.distribution.others, 2, 100) })).toBeVisible();
  });

  test("ignore archived equipment", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      const supplier = await seeder.supplier("Unico");
      const assetType = await seeder.assetType("Tipo");
      await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: "U-1" });
      const dropped = await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: "U-2" });
      await setArchived("equipments", [dropped], true);
    } finally {
      await seeder.close();
    }
    await page.goto("/");
    const card = distributionCard(page, t.distribution.bySupplier);
    await expect(card.getByText(t.distribution.total(1))).toBeVisible();
    await expect(card.getByRole("progressbar", { name: t.distribution.row("UNICO", 1, 100) })).toBeVisible();
  });
});

test.describe("dashboard for read-only company-wide users", () => {
  for (const key of ["viewer", "fleet_analyst"] as const) {
    test.describe(`as ${key}`, () => {
      test.use({ storageState: storageStatePath(key) });
      test.beforeEach(resetCatalogs);

      test("sees every card and both distributions", async ({ page }) => {
        const seeder = await openSeeder();
        try {
          await seedEquipmentBySupplier(seeder, [2]);
        } finally {
          await seeder.close();
        }
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1, name: t.greeting(WORLD_USERS[key].displayName) })).toBeVisible();
        await expectKpi(page, "equipment", 2, "/fleet");
        await expectKpi(page, "divisions", 1, "/organization");
        await expect(distributionCard(page, t.distribution.bySupplier)).toBeVisible();
        await expect(distributionCard(page, t.distribution.byAssetType)).toBeVisible();
      });
    });
  }
});

test.describe("dashboard for scoped users", () => {
  for (const key of ["manager", "supervisor"] as const) {
    test.describe(`as ${key}`, () => {
      test.use({ storageState: storageStatePath(key) });
      test.beforeEach(resetCatalogs);

      test("shows no supplier or asset type cards and no distributions, only the equipment it can see", async ({ page }) => {
        const seeder = await openSeeder();
        try {
          await seedEquipmentBySupplier(seeder, [2]);
        } finally {
          await seeder.close();
        }
        await page.goto("/");
        await expect(page.getByRole("heading", { level: 1, name: t.greeting(WORLD_USERS[key].displayName) })).toBeVisible();
        for (const label of [t.kpi.suppliers, t.kpi.assetTypes]) {
          await expect(kpiCard(page, label)).toHaveCount(0);
        }
        // Equipment now follows its assignment (D6): two unassigned units are invisible to a scoped reader,
        // so its card is the true count of what it sees (zero), not the company total.
        await expectKpi(page, "equipment", 0, "/fleet");
        await expect(page.getByRole("progressbar")).toHaveCount(0);
        await expect(distributionCard(page, t.distribution.bySupplier)).toHaveCount(0);
      });

      test("counts the equipment placed in its scope and no other, still without suppliers or distributions", async ({ page }) => {
        const seeder = await openSeeder();
        try {
          const { assetType, suppliers } = await seedEquipmentBySupplier(seeder, [3]);
          const other = await seeder.equipment({ supplierId: suppliers[0] ?? "", assetTypeId: assetType, internalCode: "ELSEWHERE-1" });
          const division = await seeder.division("Dash other");
          const site = await seeder.site("Dash other site");
          const operation = await seeder.operation({ division, site, name: "Dash other op", costCenter: "7001" });
          await seeder.assign({ equipmentId: other, operationId: operation });
          const mine = await seeder.equipment({ supplierId: suppliers[0] ?? "", assetTypeId: assetType, internalCode: "MINE-1" });
          await seeder.assign({ equipmentId: mine, operationId: readWorld().ids.operation });
        } finally {
          await seeder.close();
        }
        await page.goto("/");
        await expectKpi(page, "equipment", 1, "/fleet");
        await expect(kpiCard(page, t.kpi.suppliers)).toHaveCount(0);
        await expect(distributionCard(page, t.distribution.byAssetType)).toHaveCount(0);
        await expect(page.getByRole("region", { name: t.firstSteps.title })).toHaveCount(0);
      });

      test("shows only the organization counts it can read, never a false zero, and no first steps", async ({ page }) => {
        await page.goto("/");
        await expect(kpiCard(page, t.kpi.operations)).toBeVisible();
        await expect(page.getByRole("region", { name: t.firstSteps.title })).toHaveCount(0);
        // The equipment card may be a true zero (nothing assigned in scope); every other card is at least 1.
        const organizationCards = page.locator(".kpi-card").filter({ hasNot: page.getByText(t.kpi.equipment, { exact: true }) });
        const values = await organizationCards.locator(".kpi-value").allTextContents();
        expect(values.length).toBeGreaterThan(0);
        expect(values.every((value) => parseInt(value, 10) >= 1)).toBe(true);
      });

      test("shows the division count only when the user can see divisions", async ({ page }) => {
        await page.goto("/");
        const divisions = kpiCard(page, t.kpi.divisions);
        if (key === "manager") await expect(divisions).toBeVisible();
        else await expect(divisions).toHaveCount(0);
      });
    });
  }
});
