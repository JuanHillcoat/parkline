import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { createThrowawayUser, expectLoginError, formError, submitCredentials } from "../support/auth-flows";
import { resetCatalogs } from "../support/data";
import { WORLD_USERS, passwordOf, storageStatePath, type RoleKey } from "../support/world";

const SESSION_COOKIE = "parkline_session";
const PROTECTED_ROUTES = ["/", "/fleet", "/organization", "/users"] as const;
const WRONG_PASSWORD = "not-the-password-1";

// resetCatalogs also clears the failed sign-in counters, so a throttled email never leaks.
test.beforeEach(resetCatalogs);
test.afterAll(resetCatalogs);

const greeting = (page: Page, role: RoleKey) =>
  page.getByRole("heading", { level: 1, name: copy.home.greeting(WORLD_USERS[role].displayName) });

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: copy.nav.accountMenu }).click();
  await page.getByRole("button", { name: copy.nav.signOut }).click();
  await expect(page).toHaveURL(/\/login$/);
}

async function failFiveTimes(page: Page, email: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await submitCredentials(page, email, WRONG_PASSWORD);
    await expectLoginError(page);
  }
}

test.describe("sign-in", () => {
  test("lands on the dashboard with the right credentials", async ({ page }) => {
    await submitCredentials(page, WORLD_USERS.admin.email, passwordOf("admin"));
    await expect(page).toHaveURL(/\/$/);
    await expect(greeting(page, "admin")).toBeVisible();
  });

  test("accepts the email in a different letter case", async ({ page }) => {
    await submitCredentials(page, WORLD_USERS.viewer.email.toUpperCase(), passwordOf("viewer"));
    await expect(greeting(page, "viewer")).toBeVisible();
  });

  test("rejects a wrong password with the generic error", async ({ page }) => {
    await submitCredentials(page, WORLD_USERS.admin.email, WRONG_PASSWORD);
    await expectLoginError(page);
  });

  test("rejects an unknown email with the same generic error", async ({ page }) => {
    await submitCredentials(page, "nobody@e2e.test", WRONG_PASSWORD);
    await expectLoginError(page);
  });

  test("keeps the typed email after a failed attempt and clears the password", async ({ page }) => {
    await submitCredentials(page, WORLD_USERS.admin.email, WRONG_PASSWORD);
    await expectLoginError(page);
    await expect(page.getByLabel(copy.login.emailLabel)).toHaveValue(WORLD_USERS.admin.email);
    await expect(page.getByLabel(copy.login.passwordLabel)).toHaveValue("");
  });

  test("shows the generic error when both fields are empty", async ({ page }) => {
    await submitCredentials(page, "", "");
    await expectLoginError(page);
  });

  test("shows the generic error when the password is empty", async ({ page }) => {
    await submitCredentials(page, WORLD_USERS.admin.email, "");
    await expectLoginError(page);
  });

  test("lets a freshly created user in (control for the deactivated case)", async ({ page }) => {
    const user = await createThrowawayUser("new-employee");
    await submitCredentials(page, user.email, user.password);
    await expect(page.getByRole("heading", { level: 1, name: copy.home.greeting("new-employee") })).toBeVisible();
  });

  test("does not let a deactivated user in, with the same generic error", async ({ page }) => {
    const user = await createThrowawayUser("former-employee", true);
    await submitCredentials(page, user.email, user.password);
    await expectLoginError(page);
  });
});

test.describe("sign-in throttle", () => {
  // Default policy (ADR-0003): 5 failures per email, then a backoff of at least one minute.
  test("blocks the sixth attempt for an email with the wait in minutes", async ({ page }) => {
    await failFiveTimes(page, "throttled@e2e.test");
    await submitCredentials(page, "throttled@e2e.test", WRONG_PASSWORD);
    await expect(formError(page)).toHaveText(copy.errors.tooManyAttempts(1));
  });

  test("keeps blocking an email even when the password is right", async ({ page }) => {
    const user = await createThrowawayUser("locked-out");
    await failFiveTimes(page, user.email);
    await submitCredentials(page, user.email, user.password);
    await expect(formError(page)).toHaveText(copy.errors.tooManyAttempts(1));
    await expect(page).toHaveURL(/\/login$/);
  });

  test("does not block another email", async ({ page }) => {
    await failFiveTimes(page, "spammed@e2e.test");
    await submitCredentials(page, WORLD_USERS.viewer.email, passwordOf("viewer"));
    await expect(greeting(page, "viewer")).toBeVisible();
  });
});

test.describe("anonymous visitor", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`is redirected from ${route} to the login page`, async ({ page }) => {
      await page.goto(route);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { level: 1, name: copy.login.title })).toBeVisible();
    });
  }

  test("sees the login form with its two fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(copy.login.pageTitle);
    await expect(page.getByLabel(copy.login.emailLabel)).toBeVisible();
    await expect(page.getByLabel(copy.login.passwordLabel)).toBeVisible();
  });
});

test.describe("session", () => {
  test("is stored in an HttpOnly cookie that scripts cannot read", async ({ page, context }) => {
    await submitCredentials(page, WORLD_USERS.admin.email, passwordOf("admin"));
    await expect(greeting(page, "admin")).toBeVisible();
    const cookie = (await context.cookies()).find((candidate) => candidate.name === SESSION_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
  });

  test.describe("when already signed in", () => {
    test.use({ storageState: storageStatePath("viewer") });

    test("opening the login page goes back to the dashboard", async ({ page }) => {
      await page.goto("/login");
      await expect(page).toHaveURL(/\/$/);
      await expect(greeting(page, "viewer")).toBeVisible();
    });
  });

  test.describe("sign-out", () => {
    test("ends the session: protected pages send the visitor to the login page", async ({ page, context }) => {
      await submitCredentials(page, WORLD_USERS.viewer.email, passwordOf("viewer"));
      await expect(greeting(page, "viewer")).toBeVisible();
      await signOut(page);
      expect((await context.cookies()).find((c) => c.name === SESSION_COOKIE)?.value ?? "").toBe("");
      for (const route of PROTECTED_ROUTES) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/login$/);
      }
    });

    test("going back after signing out does not show the protected page again", async ({ page }) => {
      await submitCredentials(page, WORLD_USERS.viewer.email, passwordOf("viewer"));
      await expect(greeting(page, "viewer")).toBeVisible();
      await signOut(page);
      await page.goBack();
      await page.reload();
      await expect(page).toHaveURL(/\/login$/);
    });

    test("revokes the token on the server, not only the cookie", async ({ page, context, browser, baseURL }) => {
      await submitCredentials(page, WORLD_USERS.viewer.email, passwordOf("viewer"));
      await expect(greeting(page, "viewer")).toBeVisible();
      const copied = (await context.cookies()).filter((c) => c.name === SESSION_COOKIE);
      await signOut(page);

      const replay = await browser.newContext({ baseURL });
      await replay.addCookies(copied);
      const replayPage = await replay.newPage();
      await replayPage.goto("/");
      await expect(replayPage).toHaveURL(/\/login$/);
      await replay.close();
    });
  });
});
