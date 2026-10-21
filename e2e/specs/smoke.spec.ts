import { expect, test } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { WORLD_USERS, storageStatePath } from "../support/world";

test.describe("anonymous visitor", () => {
  test("is redirected from the dashboard to the login page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: copy.login.title })).toBeVisible();
  });
});

test.describe("administrator", () => {
  test.use({ storageState: storageStatePath("admin") });

  test("sees the greeting and the sidebar entries", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: copy.home.greeting(WORLD_USERS.admin.displayName) })).toBeVisible();
    const sidebar = page.getByRole("complementary");
    for (const label of [copy.nav.home, copy.nav.fleet, copy.nav.users, copy.nav.organization]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
    }
  });
});
