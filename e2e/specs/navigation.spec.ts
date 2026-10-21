import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { resetCatalogs } from "../support/data";
import { ROLE_KEYS, WORLD_USERS, storageStatePath, type RoleKey } from "../support/world";

type Route = "/fleet" | "/organization" | "/users";
type Entry = { readonly label: string; readonly route: Route };

const FLEET: Entry = { label: copy.nav.fleet, route: "/fleet" };
const ORGANIZATION: Entry = { label: copy.nav.organization, route: "/organization" };
const USERS: Entry = { label: copy.nav.users, route: "/users" };
const ALL: readonly Entry[] = [FLEET, USERS, ORGANIZATION];

/** Sidebar entries per role (app/_lib/navigation.ts, catalog-access.ts, permission.ts). */
const VISIBLE: Readonly<Record<RoleKey, readonly Entry[]>> = {
  admin: [FLEET, USERS, ORGANIZATION],
  fleet_analyst: [FLEET, ORGANIZATION],
  viewer: [FLEET, ORGANIZATION],
  manager: [ORGANIZATION], // scoped to a division: no fleet (company-wide readers only), no user admin
  supervisor: [ORGANIZATION], // scoped to an operation
};

const RESTRICTED_TITLE: Readonly<Record<Route, string>> = {
  "/fleet": copy.fleet.restrictedTitle,
  "/organization": copy.organization.restrictedTitle,
  "/users": copy.users.restrictedTitle,
};

const sidebar = (page: Page) => page.getByRole("complementary");
const accountTrigger = (page: Page) => page.getByRole("button", { name: copy.nav.accountMenu });
const accountPopup = (page: Page) => page.getByRole("group", { name: copy.nav.accountMenu });

test.beforeAll(resetCatalogs);

for (const role of ROLE_KEYS) {
  test.describe(`sidebar and routes as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    const visible = VISIBLE[role];

    test("shows exactly the entries the role may open", async ({ page }) => {
      await page.goto("/");
      await expect(sidebar(page).getByRole("link")).toHaveText([copy.nav.home, ...visible.map((entry) => entry.label)]);
    });

    for (const entry of ALL.filter((candidate) => !visible.includes(candidate))) {
      test(`opening ${entry.route} by URL shows the restricted notice`, async ({ page }) => {
        await page.goto(entry.route);
        await expect(page.getByRole("heading", { level: 1, name: RESTRICTED_TITLE[entry.route] })).toBeVisible();
      });
    }

    for (const entry of visible) {
      test(`opens ${entry.route} from the sidebar`, async ({ page }) => {
        await page.goto("/");
        await sidebar(page).getByRole("link", { name: entry.label }).click();
        await expect(page).toHaveURL(new RegExp(`${entry.route}$`));
        await expect(page.getByRole("heading", { level: 1, name: RESTRICTED_TITLE[entry.route] })).toHaveCount(0);
      });
    }
  });
}

test.describe("shell", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("the top bar title follows the section", async ({ page }) => {
    const titles: readonly (readonly [string, string])[] = [
      ["/", copy.nav.home],
      ["/fleet", copy.nav.fleet],
      ["/users", copy.nav.users],
      ["/organization", copy.nav.organization],
    ];
    for (const [route, title] of titles) {
      await page.goto(route);
      await expect(page.locator(".topbar-title")).toHaveText(title);
    }
  });

  test("only the link of the current section has aria-current=page", async ({ page }) => {
    await page.goto("/fleet");
    await expect(sidebar(page).getByRole("link", { name: copy.nav.fleet })).toHaveAttribute("aria-current", "page");
    await expect(sidebar(page).locator("[aria-current]")).toHaveCount(1);
  });

  test("the home link is current on the dashboard and not on other sections", async ({ page }) => {
    await page.goto("/");
    await expect(sidebar(page).getByRole("link", { name: copy.nav.home })).toHaveAttribute("aria-current", "page");
    await page.goto("/users");
    await expect(sidebar(page).getByRole("link", { name: copy.nav.home })).not.toHaveAttribute("aria-current", "page");
  });

  test("keeps the current link when the section has a query string", async ({ page }) => {
    await page.goto("/fleet?tab=suppliers");
    await expect(sidebar(page).getByRole("link", { name: copy.nav.fleet })).toHaveAttribute("aria-current", "page");
  });

  test("the skip link is the first tab stop and moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: copy.nav.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toHaveAttribute("href", "#content");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#content$/);
    await expect(page.locator("main#content")).toBeVisible();
  });
});

for (const role of ROLE_KEYS) {
  test.describe(`account menu as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });

    test("shows the display name and the role label, and offers sign-out", async ({ page }) => {
      const { displayName } = WORLD_USERS[role];
      await page.goto("/");
      await expect(accountTrigger(page)).toContainText(displayName);
      await expect(accountTrigger(page)).toContainText(copy.roles[role]);
      await expect(accountTrigger(page)).toHaveAttribute("aria-expanded", "false");
      await accountTrigger(page).click();
      await expect(accountTrigger(page)).toHaveAttribute("aria-expanded", "true");
      await expect(accountPopup(page)).toContainText(displayName);
      await expect(accountPopup(page)).toContainText(copy.roles[role]);
      await expect(accountPopup(page).getByRole("button", { name: copy.nav.signOut })).toBeVisible();
    });
  });
}

test.describe("account menu behavior", () => {
  test.use({ storageState: storageStatePath("viewer") });

  test("closes with Escape", async ({ page }) => {
    await page.goto("/");
    await accountTrigger(page).click();
    await expect(accountPopup(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(accountPopup(page)).toBeHidden();
  });

  test("closes with a click outside", async ({ page }) => {
    await page.goto("/");
    await accountTrigger(page).click();
    await expect(accountPopup(page)).toBeVisible();
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    await expect(accountPopup(page)).toBeHidden();
  });
});

test.describe("not found", () => {
  test("shows the 404 page for an unknown route", async ({ page }) => {
    const response = await page.goto("/this-page-does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: copy.errors.notFound.title })).toBeVisible();
    await expect(page.getByText(copy.errors.notFound.text)).toBeVisible();
  });

  test.describe("signed in", () => {
    test.use({ storageState: storageStatePath("viewer") });

    test("the 404 page links back to the dashboard", async ({ page }) => {
      await page.goto("/this-page-does-not-exist");
      await page.getByRole("link", { name: copy.errors.notFound.home }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { level: 1, name: copy.home.greeting(WORLD_USERS.viewer.displayName) })).toBeVisible();
    });
  });
});
