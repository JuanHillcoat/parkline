import { expect, test } from "@playwright/test";

// The server of these tests is a production build started with the development sign-in variables set: the
// shortcut must stay inert there (it exists only under `next dev`).
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("the development sign-in shortcut in a production build", () => {
  test("/dev-login answers an empty 404 and sets no session", async ({ request }) => {
    const response = await request.get("/dev-login", { maxRedirects: 0 });
    expect(response.status()).toBe(404);
    expect(await response.text()).toBe("");
    expect(response.headers()["set-cookie"]).toBeUndefined();
  });

  test("an anonymous visit to a page goes to /login, never to /dev-login", async ({ page }) => {
    await page.goto("/fleet");
    await expect(page).toHaveURL(/\/login$/);
  });
});
