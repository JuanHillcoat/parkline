# End-to-end tests

Playwright drives a real Chromium against the **compiled** app (`next start`) on port 3100
(the dev server uses 3000) and an **ephemeral** Postgres database. Nothing persistent is used.

## Run

```
pnpm exec playwright install chromium   # once per machine
pnpm db:up                              # Postgres on localhost:54329
pnpm test:e2e                           # builds, then runs everything
pnpm test:e2e:only                      # runs against the current build (no rebuild)
pnpm test:e2e:only --project=mobile     # 400x608 viewport; only tests tagged @mobile
pnpm test:e2e:only e2e/specs/smoke.spec.ts
```

The HTML report goes to `playwright-report/`, traces and screenshots of failures to `test-results/`
(both git-ignored).

## How isolation works

`playwright.config.ts` starts `e2e/support/start-server.ts` as the web server. It:

1. connects as the cluster administrator (`E2E_ADMIN_DATABASE_URL`; else `DATABASE_URL` when it
   points to this machine; else `postgres://parkline:parkline_dev@localhost:54329/postgres`);
2. creates the database `parkline_e2e_<time>_<random>`, runs the migrations and creates a
   restricted login `e2e_login_<time>_<random>` with a random password (member of `parkline_app`);
3. builds the synthetic world with the application use cases (see below) and writes the random
   passwords to `e2e/.world.json` (git-ignored, never printed);
4. starts `next start -p 3100` connected as the restricted login, like production.

On exit the launcher stops the app and drops the database and the login. Because Playwright stops
the process tree without signals on Windows, `e2e/support/global-teardown.ts` drops them as well,
and each start sweeps `parkline_e2e_*` databases and `e2e_login_*` logins older than ten minutes
left by a crashed run. The `parkline` development database is never opened.

Tests run with one worker, in order, and share the database. A suite that creates data must call
`resetCatalogs()` in `beforeEach` or `afterAll`.

## The world

One tenant and five users (`e2e/support/world.ts`): `admin`, `fleet_analyst` and `viewer` over the
whole company, `manager` over `DIVISION E2E`, and `supervisor` over `OPERATION E2E` (which uses
`SITE E2E`). `resetCatalogs()` keeps these users and the three organization rows (by id) and
deletes everything else except the append-only audit log. Do not edit or archive the world's own
organization rows; create your own with the seeder. The seeder (`openSeeder()` in `e2e/support/data.ts`) also creates assignments (`assign`, `move`, `end`) and archives equipment as the world's fleet analyst (`archiveEquipment`), and `resetCatalogs()` deletes the assignments before the equipment. Spec files of the assignment feature: `fleet-board`, `equipment-detail`, `equipment-assignments`, `equipment-replace` and `equipment-detail-actions`.

## Writing a suite

```ts
import { expect, test } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import { storageStatePath } from "../support/world";

test.describe("fleet as analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") }); // signed in, no login per test
  test.beforeEach(resetCatalogs);

  test("lists a supplier", async ({ page }) => {
    const seeder = await openSeeder(); // creates rows through the use cases
    await seeder.supplier("Acme");
    await seeder.close();
    await page.goto("/fleet");
    await expect(page.getByText("ACME")).toBeVisible();
  });
});
```

- Specs are `e2e/specs/*.spec.ts`; Vitest never picks them up. Tag a test `@mobile` (in its title)
  to run it only in the `mobile` project; untagged tests run only in `desktop`.
- Import Spanish strings from `app/_lib/copy.ts` instead of repeating them.
- `login(page, role)` (`e2e/support/auth.ts`) signs in through the real form, for tests of the
  sign-in itself. The `setup` project stores one session per role under `e2e/.auth/`.
- `passwordOf(role)` and `readWorld()` read the run's generated credentials and ids.
- Unit tests of pure helpers live in `e2e/support/__tests__/*.test.ts` and run with `pnpm test`.
