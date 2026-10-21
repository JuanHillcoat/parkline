/**
 * Setup project: signs in once per role through the real form and stores the browser state under
 * `e2e/.auth/`, so suites can reuse it with `test.use({ storageState: storageStatePath(role) })`.
 */
import { test as setup } from "@playwright/test";
import { login } from "../support/auth";
import { ROLE_KEYS, storageStatePath } from "../support/world";

for (const role of ROLE_KEYS) {
  setup(`sign in as ${role}`, async ({ page }) => {
    await login(page, role);
    await page.context().storageState({ path: storageStatePath(role) });
  });
}
