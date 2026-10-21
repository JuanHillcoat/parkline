import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { BASE_URL, E2E_PORT, STATE_DIR } from "./e2e/support/world";

/**
 * End-to-end tests run against the compiled app (`next start`) on their own port, with an
 * ephemeral database created by `e2e/support/start-server.ts`. Build first (`pnpm test:e2e`
 * does it; `pnpm test:e2e:only` does not). Specs are `*.spec.ts`; a test tagged `@mobile`
 * runs only in the `mobile` project, every other test only in `desktop`.
 */
const LAUNCHER =
  "node --import ./scripts/register-ts-resolver.mjs --experimental-transform-types " +
  "--disable-warning=ExperimentalWarning e2e/support/start-server.ts";

const isCi = Boolean(process.env.CI);
const dependencies = ["setup"];

export default defineConfig({
  testDir: "./e2e/specs",
  workers: 1,
  fullyParallel: false,
  retries: isCi ? 1 : 0,
  forbidOnly: isCi,
  outputDir: resolve(STATE_DIR, "test-results"),
  reporter: [["list"], ["html", { outputFolder: resolve(STATE_DIR, "playwright-report"), open: "never" }]],
  globalTeardown: "./e2e/support/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: LAUNCHER,
    port: E2E_PORT,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "desktop",
      testMatch: /.*\.spec\.ts/,
      grepInvert: /@mobile/,
      dependencies,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      testMatch: /.*\.spec\.ts/,
      grep: /@mobile/,
      dependencies,
      use: { ...devices["Desktop Chrome"], viewport: { width: 400, height: 608 }, hasTouch: true },
    },
  ],
});
