/**
 * Sign-in through the real login form; the setup project stores the result per role.
 */
import { expect, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { WORLD_USERS, passwordOf, type RoleKey } from "./world";

/** Signs in as a world user through the form and waits for the dashboard greeting. */
export async function login(page: Page, role: RoleKey): Promise<void> {
  const user = WORLD_USERS[role];
  await page.goto("/login");
  await page.getByLabel(copy.login.emailLabel).fill(user.email);
  await page.getByLabel(copy.login.passwordLabel).fill(passwordOf(role));
  await page.getByRole("button", { name: copy.login.submit }).click();
  await expect(page.getByRole("heading", { level: 1, name: copy.home.greeting(user.displayName) })).toBeVisible();
}
